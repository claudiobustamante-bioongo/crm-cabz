-- 15: PDF de facturas mexicanas que se clasificaron como "extranjera" porque su XML iba en otro lote.
-- Se borran del registro para que la siguiente sincronización los anexe a su CFDI.
with d as (
  delete from drive_sync where tipo = 'extranjera' and carpeta !~* 'extranjer' returning documento_id)
delete from documentos where id in (select documento_id from d where documento_id is not null);
select tipo, count(*) from drive_sync group by tipo order by 1;
