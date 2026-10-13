"""Regression boundary for Appwrite transaction-list staging and pagination."""
from copy import deepcopy
import json
from types import SimpleNamespace

from appwrite.exception import AppwriteException
import pytest

from test_personal_workspaces import m


class TablesBoundary:
    def __init__(self):
        self.committed, self.pending, self.baselines = {}, {}, {}
        self.calls = []

    def create_transaction(self, **kwargs):
        return SimpleNamespace(id='transaction')

    def seed(self, session, table, data):
        key = ('aw_' + table, session.row_id(table, data))
        self.committed[key] = deepcopy(data)
        return key

    def get_row(self, *, table_id, row_id, transaction_id=None, **kwargs):
        key = table_id, row_id
        data = self.pending.get(key, self.committed.get(key)) if transaction_id else self.committed.get(key)
        if data is None:
            raise AppwriteException('Missing row', 404)
        return SimpleNamespace(id=row_id, data=deepcopy(data))

    def create_row(self, *, table_id, row_id, data, permissions, transaction_id, **kwargs):
        assert permissions == [] and transaction_id == 'transaction'
        key = table_id, row_id
        if self.pending.get(key, self.committed.get(key)) is not None:
            raise AppwriteException('Duplicate row', 409)
        self.baselines.setdefault(key, deepcopy(self.committed.get(key)))
        self.pending[key] = deepcopy(data)

    def update_row(self, *, table_id, row_id, data, transaction_id, **kwargs):
        previous = self.get_row(table_id=table_id, row_id=row_id, transaction_id=transaction_id).data
        key = table_id, row_id
        self.baselines.setdefault(key, deepcopy(self.committed.get(key)))
        self.pending[key] = dict(previous, **deepcopy(data))

    def delete_row(self, *, table_id, row_id, transaction_id, **kwargs):
        self.get_row(table_id=table_id, row_id=row_id, transaction_id=transaction_id)
        key = table_id, row_id
        self.baselines.setdefault(key, deepcopy(self.committed.get(key)))
        self.pending[key] = None

    def list_rows(self, *, table_id, queries, transaction_id=None, **kwargs):
        self.calls.append(dict(table=table_id, queries=queries, transaction_id=transaction_id, **kwargs))
        rows = [SimpleNamespace(id=rid, data=deepcopy(data))
                for (name, rid), data in self.committed.items() if name == table_id]
        parsed = [json.loads(q) for q in queries]
        for query in parsed:
            method, key, values = query['method'], query.get('attribute'), query.get('values', [])
            if method == 'equal':
                rows = [row for row in rows if row.data.get(key) in values]
            elif method == 'isNull':
                rows = [row for row in rows if row.data.get(key) is None]
            elif method == 'lessThan':
                rows = [row for row in rows if row.data.get(key) is not None and row.data[key] < values[0]]
        for query in reversed(parsed):
            method, key = query['method'], query.get('attribute')
            if method in ('orderAsc', 'orderDesc'):
                def value(row):
                    field = row.id if key == '$id' else row.data.get(key)
                    return field is not None, field
                rows.sort(key=value, reverse=method == 'orderDesc')
        cursor = next((q['values'][0] for q in parsed if q['method'] == 'cursorAfter'), None)
        if cursor:
            position = next(i for i, row in enumerate(rows) if row.id == cursor)
            rows = rows[position + 1:]
        limit = next(q['values'][0] for q in parsed if q['method'] == 'limit')
        rows = rows[:limit]
        if transaction_id:
            # Reproduce the observed Cloud behavior: pending rows are appended
            # without applying query filters, sort order, cursor or page size.
            rows += [SimpleNamespace(id=rid, data=deepcopy(data))
                     for (name, rid), data in self.pending.items() if name == table_id and data is not None]
        return SimpleNamespace(rows=rows)

    def update_transaction(self, *, commit=False, rollback=False, **kwargs):
        if commit:
            for key, baseline in self.baselines.items():
                if self.committed.get(key) != baseline:
                    raise AppwriteException('Conflict', 409)
            for key, data in self.pending.items():
                if data is None:
                    self.committed.pop(key, None)
                else:
                    self.committed[key] = deepcopy(data)
        self.pending.clear()
        return SimpleNamespace(status='committed' if commit else 'rolledBack')


@pytest.fixture
def session():
    service = TablesBoundary()
    return m.TablesSession(service, 'database'), service


def resource(key, workspace='own', product='sheets', title=None):
    return dict(id=key, workspace=workspace, product=product, kind='workbook',
                title=title or key, payload='{}', version=1, created_by='owner')


def test_staged_rows_obey_workspace_product_and_storage_filters(session):
    unit, service = session
    service.seed(unit, 'resources', resource('saved'))
    unit.insert('resources', resource('new'))
    unit.insert('resources', resource('other', 'someone-else'))
    unit.insert('resources', resource('chat', product='orbit'))
    result = unit.rows('resources', {'workspace': 'own', 'product': 'sheets'})
    assert {row['id'] for row in result} == {'saved', 'new'}
    assert unit.rows('resources', {'workspace': 'absent'}) == []
    assert not unit.file_referenced('nonexistent-file')
    assert all(call['transaction_id'] is None and call['ttl'] == 0 for call in service.calls)


def test_guard_only_writes_do_not_pollute_filtered_results(session):
    unit, service = session
    service.seed(unit, 'resources', resource('private', 'other'))
    assert unit.one('resources', {'id': 'private'})['workspace'] == 'other'
    assert service.pending
    assert unit.rows('resources', {'workspace': 'own'}) == []


def test_staged_updates_can_enter_leave_or_reorder_filtered_pages(session):
    unit, service = session
    for row in (resource('a', title='Alpha'), resource('b', title='Beta'), resource('c', 'other', title='Gamma')):
        service.seed(unit, 'resources', row)
    unit.update('resources', {'id': 'a'}, {'workspace': 'other'})
    unit.update('resources', {'id': 'c'}, {'workspace': 'own', 'title': 'Aardvark'})
    assert unit.rows('resources', {'workspace': 'own'}, columns=['id'], order=['title'], limit=1) == [{'id': 'c'}]
    assert [row['id'] for row in unit.rows('resources', {'workspace': 'own'}, order=['title'])] == ['c', 'b']
    assert unit.one('resources', {'workspace': 'own', 'title': 'Aardvark'})['id'] == 'c'


def test_staged_notification_filter_sort_limit_precede_projection(session):
    unit, service = session
    for index in (20, 40, 60):
        service.seed(unit, 'notifications', dict(id=index, workspace='own', recipient='alice', read_at=None))
    unit.insert('notifications', dict(id=50, workspace='own', recipient='alice', read_at=None))
    unit.insert('notifications', dict(id=55, workspace='own', recipient='bob', read_at=None))
    unit.insert('notifications', dict(id=45, workspace='own', recipient='alice', read_at=1))
    assert unit.rows('notifications', {'workspace': 'own', 'recipient': 'alice', 'read_at': None},
                     columns=['id'], order=['-id'], limit=2, less_than={'id': 60}) == [{'id': 50}, {'id': 40}]


def test_delete_is_exact_and_cascades_only_matching_resource(session):
    unit, service = session
    for key in ('delete', 'keep'):
        unit.insert('resources', resource(key))
        unit.insert('grants', dict(resource=key, user='alice', permission='read'))
        unit.insert('folder_membership', dict(child=key, parent='folder'))
    assert unit.delete('resources', {'id': 'delete'}) == 1
    assert unit.delete('resources', {'id': 'delete'}) == 0
    assert unit.rows('resources', columns=['id']) == [{'id': 'keep'}]
    assert unit.rows('grants', columns=['resource']) == [{'resource': 'keep'}]
    assert unit.rows('folder_membership', columns=['child']) == [{'child': 'keep'}]
    unit.commit()
    assert {key[0] for key in service.committed} == {'aw_resources', 'aw_grants', 'aw_folder_membership'}
    assert len(service.committed) == 3


def test_delete_rechecks_selector_after_guard_read(session, monkeypatch):
    unit, service = session
    key = service.seed(unit, 'resources', resource('moved'))
    original = unit.protected_row
    def moved(table, row_id):
        service.committed[key]['workspace'] = 'other'
        return original(table, row_id)
    monkeypatch.setattr(unit, 'protected_row', moved)
    assert unit.delete('resources', {'workspace': 'own'}) == 0
    unit.commit()
    assert service.committed[key]['workspace'] == 'other'


def test_pagination_fills_limit_after_staged_deletes_and_updates(session):
    unit, service = session
    for index in range(230):
        service.seed(unit, 'resources', resource(f'r{index:03}'))
    unit.delete('resources', {'id': 'r000'})
    unit.update('resources', {'id': 'r001'}, {'workspace': 'other'})
    unit.insert('resources', resource('new', title='r050.5'))
    result = unit.rows('resources', {'workspace': 'own'}, order=['title'], columns=['id'], limit=120)
    assert len(result) == 120
    assert result[0] == {'id': 'r002'} and result[49] == {'id': 'new'}
    assert result[-1] == {'id': 'r120'}
    assert len(unit.rows('resources', {'workspace': 'own'})) == 229


def test_same_row_insert_update_delete_does_not_reappear(session):
    unit, _ = session
    unit.insert('resources', resource('new'))
    unit.update('resources', {'id': 'new'}, {}, increments={'version': 1})
    assert unit.rows('resources', columns=['version']) == [{'version': 2}]
    unit.delete('resources', {'id': 'new'})
    assert unit.rows('resources') == []
    assert unit.one('resources', {'id': 'new'}) is None


def test_write_conflicts_still_fail_atomic_commit(session):
    unit, service = session
    key = service.seed(unit, 'resources', resource('existing'))
    unit.one('resources', {'id': 'existing'})
    service.committed[key]['version'] = 2
    unit.update('resources', {'id': 'existing'}, {'title': 'Stale'})
    with pytest.raises(AppwriteException) as error:
        unit.commit()
    assert error.value.code == 409
    unit.rollback()
    assert service.committed[key]['title'] == 'existing'


@pytest.mark.parametrize('limit', [0, -1, True, 1.5])
def test_invalid_limits_rejected_before_query(session, limit):
    unit, service = session
    with pytest.raises(ValueError, match='limit'):
        unit.rows('resources', limit=limit)
    assert not service.calls


def test_broken_cursor_fails_instead_of_returning_partial_rows(session, monkeypatch):
    unit, service = session
    row = SimpleNamespace(id='same', data=resource('repeated'))
    monkeypatch.setattr(service, 'list_rows', lambda **kwargs: SimpleNamespace(rows=[row] * 100))
    with pytest.raises(RuntimeError, match='pagination'):
        unit.rows('resources')


def test_readonly_list_never_stages_a_guard_or_transaction(session):
    unit, service = session
    service.seed(unit, 'resources', resource('saved'))
    reader = m.TablesSession(service, 'database', readonly=True)
    assert reader.rows('resources', columns=['id']) == [{'id': 'saved'}]
    assert not service.pending
