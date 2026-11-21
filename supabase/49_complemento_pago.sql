-- 49: complementos de pago (CFDI tipo P). Se guardan con tipo 'pago' (no cuentan como gasto ni deducción) y marcan
--     la factura PPD relacionada como pagada (cfdi.pagada_en). Correr el alter type en su propia transacción.
alter type tipo_cfdi add value if not exists 'pago';

alter table cfdi add column if not exists pagada_en date;          -- fecha del complemento de pago que la liquidó
alter table cfdi add column if not exists relacionados text[];    -- en un complemento: UUIDs de las facturas que paga
create index if not exists cfdi_relacionados_idx on cfdi using gin (relacionados);
