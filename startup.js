var XLSX_ZAHL=globalThis.XLSX_ZAHL_PAYLOAD;
AlaadaModules.register('xlsx', typeof XLSX !== 'undefined', 'Workbook import/export');
AlaadaModules.register('xlsx-numbers', typeof XLSX_ZAHL !== 'undefined', 'Numbers compatibility');
AlaadaModules.register('charts', typeof Chart !== 'undefined', 'Interactive charts');
