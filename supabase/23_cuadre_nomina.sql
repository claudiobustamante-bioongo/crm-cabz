-- 23: en los CFDI de nómina el ISR ya viene dentro de "Descuento"; el cuadre subtotal − descuento + iva − ret − total
--     no aplica. Se exime a los tipo N (y a los P/T, que van en cero).
alter table cfdi drop constraint if exists cfdi_cuadre;
alter table cfdi add constraint cfdi_cuadre check (
  coalesce(tipo_comprobante, 'I') in ('N', 'P', 'T')
  or abs(subtotal - descuento + iva - ret_isr - ret_iva - total) <= 1);
