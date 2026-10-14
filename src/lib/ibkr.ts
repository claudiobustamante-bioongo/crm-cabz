/* Parser del CSV mensual de IBKR (Activity Statement). Port fiel del Panel Contable CABZ:
   mismas secciones, misma clasificación ETF/acción/opción/forex/bono, importes en moneda base (USD). */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface IbkrRow {
  cuenta: string | null; year: number | null; mes: number | null;
  re: number; ra: number; ro: number; rf: number; rb: number;
  sne: number; sna: number; sno: number; snf: number; snb: number;
  db: number; dr: number; cb: number; cr: number; cm: number; ib: number; dep: number;
  nav_efe: number; nav_acc: number; nav_opc: number; nav_bono: number; nav_dev: number; nav_tot: number;
}
const IB_SECCIONES: Record<string,string>={'Account Information':'Información sobre la cuenta','Realized & Unrealized Performance Summary':'Resumen del rendimiento realizado y no realizado','Cash Report':'Informe de efectivo','Dividends':'Dividendos','Withholding Tax':'Retención de impuestos','Interest':'Interés','Net Asset Value':'Valor liquidativo'};
const IB_ETIQUETAS_ACTIVO: Record<string,string>={'Total (All Assets)':'Total (todos los activos)','Stocks':'Acciones','Bonds':'Bonos','Forex':'Fórex','Equity and Index Options':'Opciones sobre acciones e índices'};
const IB_CAMPOS_CUENTA: Record<string,string>={'Account':'Cuenta','Name':'Nombre','Account Alias':'Alias de la cuenta'};
const IB_CAMPOS_EFECTIVO: Record<string,string>={'Commissions':'Comisiones','Other Fees':'Otras comisiones','Broker Interest Paid and Received':'Interés del bróker pagado y recibido','Bond Interest Paid and Received':'Interés del bono pagado y recibido','Dividends':'Dividendos','Withholding Tax':'Retención de impuestos','Account Transfers':'Transferencia de cuentas','Withdrawals':'Retiradas','Deposits':'Depósitos'};
const IB_NAV_CLASES: Record<string,string>={'Efectivo':'efe','Cash':'efe','Acción':'acc','Acciones':'acc','Stock':'acc','Opciones':'opc','Options':'opc','Bonos':'bono','Bono':'bono','Bond':'bono','Bonds':'bono','Devengo de intereses':'dev','Interest Accruals':'dev','Dividendos devengados':'dev','Dividend Accruals':'dev','Devengo de dividendos':'dev'};
const IB_DIVISA_BASE: Record<string,string>={'Base Currency Summary':'Resumen de la divisa base'};
const normSec=(s:any)=>{s=String(s||'').replace(/^\uFEFF/,'').trim();return IB_SECCIONES[s]||s;};
const normLbl=(s:any,m:Record<string,string>)=>{s=String(s||'').trim();return m[s]||s;};
const ETF_SYMBOLS=new Set(['TMF','TLT','YINN','PSP','MCHI','BIL','EWJ','HDV','IVV','IBIT','LQD','VIXY','UVIX','JBBB','SHY','AGGU','EIMI','EWSP','FUSA','HMAD','ICGA','IUIT','IUVL','LQDA','NDIA','NAFTRACISHRS','VAPU','VWCG','WSML','XDEW','IHYU','SPY','QQQ','VTI','EFA','EEM','GLD','SLV','USO','DTLA','IB01','IDTL','SDHA','SDIA','UDOW','TQQQ']);
const ACCIONES_SYMBOLS=new Set(['CYBN','OZEM','BRK B','BRKB','ETOR','LLY','MSFT','REGN','V','VRTX','TMO','BITO']);
export function classify(symbol:string,category:string){const sym=(symbol||'').trim().toUpperCase();const ns=sym.replace(/\s+/g,'');const cat=(category||'').toLowerCase();
  if(cat.includes('opcion')||cat.includes('option'))return'opciones';
  if(cat.includes('fórex')||cat.includes('forex'))return'forex';
  if(cat.includes('bono'))return'bonos';
  if(cat.includes('accion')||cat.includes('acción')){if(ETF_SYMBOLS.has(sym)||ETF_SYMBOLS.has(ns))return'etfs';if(ACCIONES_SYMBOLS.has(sym)||ACCIONES_SYMBOLS.has(ns))return'acciones';return'etfs';}
  return'otros';}
function pf(s:any):number{if(!s||s==='--'||s==='')return 0;const c=String(s).trim().replace(/,/g,'');if(c===''||c==='--')return 0;const v=parseFloat(c);return isNaN(v)?0:v;}
function parseCSV(text:string):string[][]{const rows:string[][]=[];const lines=text.split(/\r?\n/);
  for(const line of lines){if(!line.trim())continue;const row:string[]=[];let cur='',q=false;
    for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"')q=!q;else if(ch===','&&!q){row.push(cur);cur='';}else cur+=ch;}
    row.push(cur);rows.push(row);}return rows;}
export function parseIBCSV(text:string,filename:string):IbkrRow{
  const rows=parseCSV(text);
  const r:any={cuenta:null,year:null,mes:null,re:0,ra:0,ro:0,rf:0,rb:0,sne:0,sna:0,sno:0,snf:0,snb:0,db:0,dr:0,cb:0,cr:0,cm:0,ib:0,dep:0,nav_efe:0,nav_acc:0,nav_opc:0,nav_bono:0,nav_dev:0,nav_tot:0};
  const m=filename.match(/U(\d+)_(\d{4})(\d{2})/);
  if(m){r.cuenta='U'+m[1];r.year=parseInt(m[2]);r.mes=parseInt(m[3]);}
  const MONTHS:Record<string,number>={'Enero':1,'Febrero':2,'Marzo':3,'Abril':4,'Mayo':5,'Junio':6,'Julio':7,'Agosto':8,'Septiembre':9,'Octubre':10,'Noviembre':11,'Diciembre':12,'January':1,'February':2,'March':3,'April':4,'May':5,'June':6,'July':7,'August':8,'September':9,'October':10,'November':11,'December':12};
  const realK:Record<string,string>={etfs:'re',acciones:'ra',opciones:'ro',forex:'rf',bonos:'rb'};
  const nrK:Record<string,string>={etfs:'sne',acciones:'sna',opciones:'sno',forex:'snf',bonos:'snb'};
  for(const row of rows){
    if(row.length<2)continue;
    const sec=normSec(row[0]);const ty=(row[1]||'').trim();
    if(sec==='Información sobre la cuenta'&&ty==='Data'){
      if(normLbl(row[2],IB_CAMPOS_CUENTA)==='Cuenta'&&row[3])r.cuenta=row[3].trim();
    }
    if(sec==='Statement'&&ty==='Data'&&row[2]==='Period'){
      const ym=(row[3]||'').match(/(\d{4})/);if(ym)r.year=parseInt(ym[1]);
      for(const n in MONTHS){if((row[3]||'').includes(n)){r.mes=MONTHS[n];break;}}
    }
    if(sec==='Resumen del rendimiento realizado y no realizado'&&ty==='Data'&&row.length>=16){
      const cat=normLbl(row[2],IB_ETIQUETAS_ACTIVO);const sym=(row[3]||'').trim();
      if(sym==='Total'||sym==='Total (todos los activos)'||!sym)continue;
      const real=pf(row[9]);const nr=pf(row[14]);
      let c:string|null=null;
      if(cat==='Acciones'&&sym)c=classify(sym,cat);
      else if(cat==='Bonos')c='bonos';
      else if(cat==='Fórex')c='forex';
      else if(cat&&cat.indexOf('Opciones')!==-1)c='opciones';
      if(c&&realK[c]){r[realK[c]]+=real;r[nrK[c]]+=nr;}
    }
    if(sec==='Informe de efectivo'&&ty==='Data'&&row.length>=5){
      const campo=normLbl(row[2],IB_CAMPOS_EFECTIVO);const div=normLbl(row[3],IB_DIVISA_BASE);
      if(div!=='Resumen de la divisa base')continue;
      const v=pf(row[4]);
      if(campo==='Comisiones'||campo==='Otras comisiones')r.cm+=v;
      else if(campo==='Interés del bróker pagado y recibido')r.ib+=v;
      else if(campo==='Interés del bono pagado y recibido')r.cb+=v;
      else if(campo==='Dividendos')r.db+=v;
      else if(campo==='Retención de impuestos'&&v<0)r.dr+=-v;
      else if(campo==='Transferencia de cuentas'||campo==='Retiradas'||campo==='Depósitos')r.dep+=v;
    }
    if(sec==='Valor liquidativo'&&ty==='Data'&&row.length>=7){
      const raw=row[2]||'';const clase=raw.trim();const at=pf(row[6]);
      if(clase&&!/%\s*$/.test(clase)&&!/^\s/.test(raw)){
        if(clase==='Total')r.nav_tot=at;
        else if(IB_NAV_CLASES[clase])r['nav_'+IB_NAV_CLASES[clase]]+=at;
      }
    }
  }
  ['re','ra','ro','rf','rb','sne','sna','sno','snf','snb','db','dr','cb','cr','cm','ib','nav_efe','nav_acc','nav_opc','nav_bono','nav_dev','nav_tot','dep'].forEach(k=>r[k]=+r[k].toFixed(2));
  return r as IbkrRow;
}

