"""Dodo release and price safeguards. No provider calls or real money in tests."""
from types import SimpleNamespace

import pytest

from test_personal_workspaces import dodo_app, m
from test_billing_reliability import activate, deliver


def purchase(env, plan='Pro', **extra):
    return env['client'].post(f'/api/workspaces/{env["workspace"]}/subscription',
        headers={'Authorization': 'Bearer alice', 'X-Alaada-Workspace': env['workspace']},
        json={'plan': plan, **extra})


def assert_no_sale(env):
    assert env['calls']['checkout_count'] == 0
    assert env['calls']['change'] == []
    with env['app'].state.store.db(readonly=True) as db:
        assert db.rows('billing_requests', {'workspace': env['workspace']}) == []
        assert db.rows('dodo_checkouts', {'workspace': env['workspace']}) == []
        assert db.one('subscriptions', {'workspace': env['workspace']})['plan'] == 'Free'


@pytest.mark.parametrize('version', [None, '', '2026-09-01', 'true'])
def test_live_catalog_needs_exact_release_approval(tmp_path, version):
    env = dodo_app(tmp_path, dodo_environment='live_mode', dodo_approved_catalog_version=version)
    status = env['client'].get('/api/health').json()['dodo_billing']
    assert not status['checkout_enabled'] and not status['plan_changes_enabled']
    assert status['management_enabled'] and status['provider'] == 'dodo'
    assert purchase(env).status_code == 503
    assert_no_sale(env)


def test_tax_policy_must_be_explicit_even_with_release_approval(tmp_path):
    env = dodo_app(tmp_path, dodo_environment='live_mode',
                   dodo_approved_catalog_version=m.PRICE_CATALOG_VERSION, dodo_tax_inclusive=None)
    assert purchase(env).status_code == 503
    assert_no_sale(env)


@pytest.mark.parametrize('field,value', [
    ('price', 29900), ('price', '99900'), ('currency', 'USD'),
    ('payment_frequency_count', 12), ('payment_frequency_count', True),
    ('payment_frequency_interval', 'Year'), ('type', 'one_time_price'),
    ('tax_inclusive', True), ('trial_period_days', 7), ('trial_amount', 100),
    ('discount', 10), ('discount_bps', 100), ('purchasing_power_parity', True),
])
def test_wrong_provider_price_creates_no_intent_or_checkout(tmp_path, field, value):
    env = dodo_app(tmp_path)
    env['products']['pdt_pro_test']['price'][field] = value
    response = purchase(env)
    assert response.status_code == 503 and 'catalog' in response.text
    assert_no_sale(env)


@pytest.mark.parametrize('field,value', [('product_id', 'pdt_other'), ('is_recurring', False)])
def test_wrong_product_identity_fails_closed(tmp_path, field, value):
    env = dodo_app(tmp_path)
    env['products']['pdt_pro_test'][field] = value
    assert purchase(env).status_code == 503
    assert_no_sale(env)


def test_provider_read_failure_creates_no_pending_lock_and_does_not_leak_secrets(tmp_path):
    env = dodo_app(tmp_path)
    def unavailable(_):
        raise RuntimeError('secret-must-not-leak')
    env['app'].state.dodo_client.products.retrieve = unavailable
    response = purchase(env)
    assert response.status_code == 503 and 'secret-must-not-leak' not in response.text
    assert_no_sale(env)


def test_server_controls_price_currency_quantity_and_catalog(tmp_path):
    env = dodo_app(tmp_path, dodo_environment='live_mode',
                   dodo_approved_catalog_version=m.PRICE_CATALOG_VERSION)
    response = purchase(env, price=1, currency='USD', product_id='pdt_attacker', quantity=100,
                        catalog_version='fake', return_url='https://attacker.invalid')
    assert response.status_code == 201
    sent = env['calls']['checkout']
    assert sent['product_cart'] == [{'product_id': 'pdt_pro_test', 'quantity': 1}]
    assert sent['billing_currency'] == 'INR'
    assert not any(sent['feature_flags'].values())
    assert sent['metadata']['catalog_version'] == m.PRICE_CATALOG_VERSION
    assert sent['metadata']['billing_environment'] == 'live_mode'
    assert sent['return_url'].startswith('https://www.alaada.com/')
    assert purchase(env).json()['id'] == response.json()['id']
    assert env['calls']['checkout_count'] == 1


def test_checkout_from_an_earlier_mapping_is_not_replayed(tmp_path):
    env = dodo_app(tmp_path)
    assert purchase(env).status_code == 201
    restarted = dodo_app(tmp_path, dodo_environment='live_mode',
                         dodo_approved_catalog_version=m.PRICE_CATALOG_VERSION)
    assert purchase(restarted).status_code == 409
    assert restarted['calls']['checkout_count'] == 0


def test_closing_sales_preserves_cancellation_and_verified_renewals(tmp_path):
    env = dodo_app(tmp_path)
    headers, event = activate(env)
    closed = dodo_app(tmp_path, dodo_environment='live_mode')
    assert purchase(closed, 'Elite').status_code == 503
    renewed, _ = deliver(closed, 'renew-after-sales-closed', event, event_type='subscription.renewed')
    assert renewed.status_code == 200
    assert purchase(closed, 'Free').status_code == 202
    assert len(closed['calls']['cancel']) == 1 and closed['calls']['change'] == []


def test_unsupported_enterprise_and_foreign_workspace_never_read_provider(tmp_path):
    env = dodo_app(tmp_path)
    def forbidden(_):
        pytest.fail('Provider must not be queried before workspace authorization')
    env['app'].state.dodo_client.products.retrieve = forbidden
    assert purchase(env, 'Enterprise').status_code == 400
    assert env['client'].post('/api/workspaces/p_someone_else/subscription',
        headers={'Authorization': 'Bearer alice', 'X-Alaada-Workspace': 'p_someone_else'},
        json={'plan': 'Pro'}).status_code in (403, 404)
    assert_no_sale(env)


@pytest.mark.parametrize('url', ['https://user:pass@checkout.dodopayments.com/session/1',
    'https://checkout.dodopayments.com:bad/session/1', 'https://checkout.dodopayments.com:8443/session/1',
    'https://dodopayments.com.attacker.invalid/session/1', 'http://checkout.dodopayments.com/session/1'])
def test_invalid_checkout_url_stays_locked_for_reconciliation(tmp_path, url):
    env = dodo_app(tmp_path)
    env['app'].state.dodo_client.checkout_sessions.create = lambda **_: SimpleNamespace(
        session_id='sess_unconfirmed', checkout_url=url)
    assert purchase(env).status_code == 502
    with env['app'].state.store.db(readonly=True) as db:
        assert db.one('dodo_checkouts', {'workspace': env['workspace']})['state'] == 'unknown'
    assert purchase(env).status_code == 409


def test_subscription_response_contains_readiness_but_not_unreleased_prices(tmp_path):
    env = dodo_app(tmp_path)
    response = env['client'].get(f'/api/workspaces/{env["workspace"]}/subscription',
                                headers={'Authorization': 'Bearer alice'})
    assert response.json()['billing'] == env['client'].get('/api/health').json()['dodo_billing']
    assert '99900' not in response.text and 'test-key' not in response.text
    assert m.TARGET_MONTHLY_PRICES == {'Free': 0, 'Pro': 99900, 'Elite': 299900, 'Enterprise': 449900}


def test_legacy_subscriber_keeps_plan_after_product_mapping_changes(tmp_path):
    env = dodo_app(tmp_path)
    _, event = activate(env)
    closed = dodo_app(tmp_path, dodo_environment='live_mode',
        dodo_products={'Pro': 'pdt_new_pro', 'Elite': 'pdt_new_elite'})
    assert deliver(closed, 'grandfather-renewal', event, event_type='subscription.renewed')[0].status_code == 200
    with closed['app'].state.store.db(readonly=True) as db:
        assert db.one('subscriptions', {'workspace': closed['workspace']})['plan'] == 'Pro'
        assert db.one('dodo_subscriptions', {'workspace': closed['workspace']})['product_id'] == 'pdt_pro_test'
    assert purchase(closed, 'Free').status_code == 202


def test_render_production_cannot_accept_test_mode_billing(tmp_path, monkeypatch):
    # Reject before contacting Dodo; production's normal Store enforces TablesDB.
    monkeypatch.setenv('RENDER', 'true')
    monkeypatch.setattr(m, 'Store', lambda *a, **kw: SimpleNamespace(postgres=False, tablesdb=False))
    with pytest.raises(ValueError, match='isolated non-production'):
        m.create_app(tmp_path / 'unused.db', dodo_environment='test_mode')


def test_real_dodo_sdk_serializes_checked_catalog_without_network(tmp_path):
    import httpx
    import json
    from dodopayments import DodoPayments
    requests = []
    def provider(req):
        requests.append(req)
        if req.method == 'GET' and req.url.path == '/products/pdt_pro_test':
            return httpx.Response(200, json={'product_id': 'pdt_pro_test', 'is_recurring': True,
                'price': {'type': 'recurring_price', 'currency': 'INR', 'price': 99900,
                          'payment_frequency_count': 1, 'payment_frequency_interval': 'Month',
                          'subscription_period_count': 1, 'subscription_period_interval': 'Year',
                          'tax_inclusive': False}})
        assert req.method == 'POST' and req.url.path == '/checkouts'
        data = json.loads(req.content)
        assert data['product_cart'] == [{'product_id': 'pdt_pro_test', 'quantity': 1}]
        assert data['metadata']['catalog_version'] == m.PRICE_CATALOG_VERSION
        assert data['billing_currency'] == 'INR'
        assert data['feature_flags']['allow_discount_code'] is False
        return httpx.Response(200, json={'session_id': 'sess_sdk',
            'checkout_url': 'https://test.checkout.dodopayments.com/session/sdk'})
    with DodoPayments(bearer_token='fake-only', environment='test_mode', max_retries=0,
            http_client=httpx.Client(transport=httpx.MockTransport(provider))) as sdk:
        env = dodo_app(tmp_path, dodo_client=sdk)
        response = purchase(env)
        assert response.status_code == 201, response.text
        assert len(requests) == 2
