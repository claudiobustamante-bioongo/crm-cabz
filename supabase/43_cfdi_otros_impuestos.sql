-- 43: CFDI con impuestos locales (ISH 3 % hoteles, etc.) o IEPS: columna otros_impuestos y cuadre que los incluye.
alter table cfdi add column if not exists otros_impuestos numeric(14,2) not null default 0;
alter table cfdi drop constraint if exists cfdi_cuadre;
alter table cfdi add constraint cfdi_cuadre check (
  coalesce(tipo_comprobante, 'I') in ('N', 'P', 'T')
  or abs(subtotal - descuento + iva + otros_impuestos - ret_isr - ret_iva - total) <= 1);
