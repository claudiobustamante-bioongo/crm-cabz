-- 14: pone el link de Drive a las facturas que ya existían cuando corrió la sincronización (subidas a mano antes)
update cfdi c set link_drive = d.link_drive
from drive_sync d
where d.cfdi_uuid = c.uuid and d.user_id = c.user_id and c.link_drive is null and d.link_drive is not null;
select count(*) as con_link from cfdi where link_drive is not null;
