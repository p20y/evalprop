export const STYLES = `
:root{
  color-scheme:light;
  --page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink-2:#52514e;--ink-3:#6f6e69;--line:#e4e3de;--line-2:#cfcec8;
  --s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;
  --pos:#2a78d6;--neg:#e34948;--neutral:#f0efec;
  --good:#0ca30c;--warn:#fab219;--crit:#d03b3b;
  --good-ink:#0a5c0a;--warn-ink:#6b4a00;--crit-ink:#9d2222;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--page);color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.wrap{max-width:980px;margin:0 auto;padding:20px 16px 56px}
h1{font-size:30px;line-height:1.15;margin:4px 0 6px;letter-spacing:-.01em}
h2{font-size:19px;line-height:1.25;margin:0 0 4px;letter-spacing:-.005em}
h3{font-size:12px;margin:20px 0 8px;color:var(--ink-2);text-transform:uppercase;letter-spacing:.06em}
p{margin:0 0 10px}
.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-2);font-weight:600}
.facts{color:var(--ink-2);margin:0}
.facts span+span::before{content:"\\00b7";margin:0 8px;color:var(--ink-3)}
.prepared{color:var(--ink-2);font-size:13px;margin-top:6px}
.recipient-note{margin:14px 0 0;padding:12px 14px;background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--s1);border-radius:8px;white-space:pre-wrap}
.property-desc{margin:14px 0 0;font-size:13px;color:var(--ink-2)}
.property-desc .desc-label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-3);margin-bottom:2px}
.property-desc p{white-space:pre-wrap;margin:0}
section.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:16px 0}
section.card>.sub{color:var(--ink-2);margin:0 0 14px;font-size:14px}
.verdict{display:grid;grid-template-columns:auto 1fr;gap:6px 18px;align-items:center;border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:18px 22px;margin:16px 0 12px}
.verdict .badge{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:16px;padding:8px 14px;border-radius:999px;border:2px solid currentColor;white-space:nowrap}
.verdict .badge svg{width:20px;height:20px}
.verdict .msg{margin:0;font-size:16px}
.verdict.t-good{border-left:6px solid var(--good)}.verdict.t-ok{border-left:6px solid var(--warn)}.verdict.t-poor{border-left:6px solid var(--crit)}
.t-good{color:var(--good-ink)}.t-ok{color:var(--warn-ink)}.t-poor{color:var(--crit-ink)}.t-neutral{color:var(--ink-2)}
.verdict .msg{color:var(--ink)}
.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:0 0 16px}
.kpi{border:1px solid var(--line);border-radius:10px;padding:12px 12px;background:var(--surface);min-width:0}
.kpi .k{font-size:12px;color:var(--ink-2)}
.kpi .v{font-size:21px;font-weight:700;letter-spacing:-.01em;margin-top:2px;line-height:1.2}
.kpi .d{font-size:12px;color:var(--ink-2);margin-top:3px;display:flex;gap:4px;align-items:center;flex-wrap:wrap}
.kpi .d svg{width:13px;height:13px;flex:none}
.ico{width:18px;height:18px;flex:none;vertical-align:-3px}
.ico.sm{width:14px;height:14px;vertical-align:-2px}
.i-good{color:var(--good)}.i-ok{color:var(--warn)}.i-poor{color:var(--crit)}.i-neutral{color:var(--ink-3)}
.summary-list{margin:0;padding:0;list-style:none}
.summary-list li{padding:9px 0;border-top:1px solid var(--line)}
.summary-list li:first-child{border-top:0;padding-top:0}
.status{display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:13px;white-space:nowrap}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{padding:8px 10px;text-align:right;border-bottom:1px solid var(--line);vertical-align:top}
th:first-child,td:first-child{text-align:left}
thead th{font-size:12px;color:var(--ink-2);font-weight:600;border-bottom:1px solid var(--line-2);vertical-align:bottom}
tbody th{font-weight:500;color:var(--ink)}
thead th{white-space:nowrap}
td[data-label=Listing],td[data-label=Status],td[data-label=Distance]{white-space:nowrap}
td.l,th.l{text-align:left}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.num{white-space:nowrap}
caption{text-align:left;font-size:13px;color:var(--ink-2);padding:0 0 8px;font-weight:600}
.checks{list-style:none;margin:0;padding:0}
.checks li{display:grid;grid-template-columns:22px 1fr auto;gap:2px 12px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}
.checks li:first-child{border-top:0}
.checks .name{font-weight:600}
.checks .thr{color:var(--ink-2);font-size:13px;grid-column:2}
.checks .act{font-weight:700;text-align:right;grid-row:1;grid-column:3}
.checks .st{grid-column:3;text-align:right;grid-row:2;font-size:12px;color:var(--ink-2)}
.callouts{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin:0 0 14px}
.callout{border:1px solid var(--line);border-radius:10px;padding:12px 14px;background:var(--surface)}
.callout .k{font-size:12px;color:var(--ink-2)}
.callout .v{font-size:24px;font-weight:700;letter-spacing:-.01em;line-height:1.25}
.callout .d{font-size:13px;color:var(--ink-2);margin-top:2px}
.callout.hero{border-color:var(--s1);box-shadow:inset 0 0 0 1px var(--s1)}
.works{margin:0;padding:0;list-style:none}
.works li{display:grid;grid-template-columns:22px 1fr;gap:10px;padding:9px 0;border-top:1px solid var(--line)}
.works li:first-child{border-top:0}
.bars{display:flex;flex-direction:column;gap:7px;margin:4px 0 14px}
.bar-row{display:grid;grid-template-columns:150px 1fr 82px;gap:12px;align-items:center;font-size:14px}
.bar-label{color:var(--ink)}
.bar-note{display:block;font-size:12px;color:var(--ink-2)}
.bar-value{text-align:right;font-weight:600}
.bar-track{height:10px;background:var(--neutral);border-radius:5px;overflow:hidden}
.bar-fill{height:100%;background:var(--s1);border-radius:5px}
.net-row span:last-child{white-space:nowrap}
.net-row{display:flex;justify-content:space-between;gap:12px;border-top:2px solid var(--ink);margin-top:2px;padding-top:8px;font-weight:700}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}
.legend{display:flex;gap:6px 16px;flex-wrap:wrap;font-size:13px;color:var(--ink-2);margin:0 0 6px}
.legend-item{display:inline-flex;align-items:center;gap:6px}
.legend-item i{width:14px;height:3px;border-radius:2px;display:inline-block}
.legend-item i.sw{width:14px;height:14px;border-radius:3px;border:1px solid var(--line-2)}
.legend-item i.base-sw{width:14px;height:14px;border-radius:3px;border:2px solid var(--ink);background:transparent}
.chart{position:relative;margin-bottom:6px}
.chart svg{width:100%;height:auto;display:block;touch-action:pan-y}
.chart.narrow{display:none}
.chart.narrow .tick{font-size:12px}.chart.narrow .end-label{font-size:12.5px}.chart.narrow .marker-label{font-size:11.5px}
.chart .grid{stroke:var(--line);stroke-width:1}
.chart .zero{stroke:var(--ink-3);stroke-width:1}
.chart .tick{font-size:11px;fill:var(--ink-3)}
.chart .end-label{font-size:12px;fill:var(--ink);font-weight:600}
.chart .line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.chart .marker{stroke:var(--ink-2);stroke-width:1;stroke-dasharray:4 3}
.chart .marker-label{font-size:11px;fill:var(--ink);paint-order:stroke;stroke:#fcfcfb;stroke-width:4px;stroke-linejoin:round}
.chart .crosshair{stroke:var(--ink-3);stroke-width:1}
.tooltip{position:absolute;pointer-events:none;background:var(--ink);color:#fff;font-size:12px;line-height:1.45;padding:8px 10px;border-radius:8px;white-space:nowrap;z-index:5}
.tooltip b{display:block;margin-bottom:2px}
.tooltip i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
.chart-note{font-size:12px;color:var(--ink-3);margin:2px 0 10px}
.heat-wrap{min-width:0}
.heat{table-layout:fixed;border-collapse:separate;border-spacing:2px;margin-top:2px}
.heat th,.heat td{padding:7px 2px;text-align:center;border:0;font-size:13px;vertical-align:middle}
.heat td{border-radius:4px;font-weight:500;color:var(--ink)}
.heat thead th{font-size:12px;color:var(--ink-2);font-weight:600}
.heat tbody th{font-size:12px;color:var(--ink-2);font-weight:600;text-align:right;padding-right:6px}
.heat th.corner{text-align:left;font-weight:500;color:var(--ink-3);font-size:11px;line-height:1.3;vertical-align:bottom}
.heat th.corner span{display:block}
.heat small{display:block;font-weight:500;font-size:10.5px;color:var(--ink-3)}
.heat .base-h{color:var(--ink);text-decoration:underline;text-underline-offset:3px}
.heat td.base{outline:2px solid var(--ink);outline-offset:-1px;font-weight:700}
.heat caption{padding-bottom:4px}
.heat col.h{width:19%}
.tag{display:inline-block;font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px;border:1px solid var(--line-2);color:var(--ink-2);white-space:nowrap;line-height:1.6}
.tag.fb{border-color:var(--warn);color:var(--warn-ink);background:#fff8e6}
.tag.same{border-color:var(--good);color:var(--good-ink)}
.tag.src-provided{border-color:var(--s1);color:#17509a;background:#eef4fc}
.tag.src-listing{border-color:var(--ink-3);color:var(--ink-2)}
.tag.src-lookup{border-color:var(--s3);color:#0b6b49;background:#eefaf5}
.tag.src-assumed{border-color:var(--warn);color:var(--warn-ink);background:#fff8e6}
.metaline{display:flex;gap:6px 18px;flex-wrap:wrap;margin:0 0 12px;font-size:14px;color:var(--ink-2)}
.metaline b{color:var(--ink)}
.note-box{font-size:13px;color:var(--ink-2);background:var(--neutral);border-radius:8px;padding:10px 12px;margin:10px 0 0}
.yt{min-width:620px}.yt th,.yt td{white-space:nowrap}
.adj{display:block;font-size:12px;color:var(--ink-3);font-weight:400}
@media (max-width:640px){.adj{display:inline;margin-left:8px}}
.verdict+.note-box{margin:0 0 12px}
.note-box.warn{background:#fff8e6;border:1px solid #f3dca0;color:var(--ink)}
.flags{list-style:none;margin:0;padding:0}
.flags li{display:grid;grid-template-columns:22px 1fr;gap:10px;padding:10px 0;border-top:1px solid var(--line)}
.flags li:first-child{border-top:0}
.flags b{display:block}
.flags .d{color:var(--ink-2);font-size:14px}
.rating{display:inline-flex;align-items:center;gap:8px}
.meter{display:inline-block;width:56px;height:6px;border-radius:3px;background:var(--neutral);overflow:hidden;vertical-align:middle}
.meter i{display:block;height:100%;background:var(--s1)}
.dnotes{list-style:none;margin:0;padding:0}
.dnotes li{display:grid;grid-template-columns:22px 1fr;gap:10px;padding:8px 0;border-top:1px solid var(--line);font-size:14px}
.dnotes li:first-child{border-top:0}
.dnotes .sec{color:var(--ink-2);font-size:12px;text-transform:uppercase;letter-spacing:.05em;display:block}
.src-list{font-size:13px;color:var(--ink-2);margin:12px 0 0;padding-left:18px}
footer.disclaimer{color:var(--ink-2);font-size:12.5px;margin-top:24px;padding-top:14px;border-top:1px solid var(--line-2)}
footer.disclaimer p{margin:0 0 8px}
.toc{display:flex;gap:6px 14px;flex-wrap:wrap;font-size:13px;margin:14px 0 0;padding:0;list-style:none}
.toc a{color:var(--ink-2);text-decoration:none;border-bottom:1px solid var(--line-2)}
.toc a:hover{color:var(--ink)}
.watermark-banner{background:var(--ink);color:#fff;text-align:center;font-size:13px;padding:8px 12px;letter-spacing:.02em}
.watermark-bg{position:fixed;inset:0;pointer-events:none;z-index:50;display:flex;align-items:center;justify-content:center;overflow:hidden}
.watermark-bg span{transform:rotate(-30deg);font-size:min(14vw,120px);font-weight:800;letter-spacing:.08em;color:rgba(11,11,11,.07);white-space:nowrap;text-transform:uppercase}
.gone{max-width:520px;margin:18vh auto;padding:0 16px;text-align:center}
@media (max-width:860px){
  .kpis{grid-template-columns:repeat(3,1fr)}
  .grid2{grid-template-columns:1fr;gap:18px}
}
@media (max-width:640px){
  .wrap{padding:14px 12px 40px}
  h1{font-size:24px}
  section.card{padding:16px 14px;border-radius:10px}
  .kpis{grid-template-columns:repeat(2,1fr)}
  .kpi .v{font-size:19px}
  .verdict{grid-template-columns:1fr;padding:16px}
  .verdict .badge{justify-self:start}
  .bar-row{grid-template-columns:1fr 70px;gap:4px 10px}
  .bar-row .bar-track{grid-column:1/-1;grid-row:2}
  .bar-row .bar-label{grid-row:1}.bar-row .bar-value{grid-row:1}
  .chart.wide{display:none}.chart.narrow{display:block}
  .heat th,.heat td{font-size:11.5px;padding:7px 1px}
  .heat thead th,.heat tbody th{font-size:11px}
  .rt thead{position:absolute;left:-9999px}
  .rt caption{display:block;width:100%}
  .rt,.rt tbody,.rt tr,.rt td{display:block;width:100%}
  .rt tr{border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin:0 0 10px}
  .rt td{display:flex;justify-content:space-between;gap:14px;text-align:right;border:0;padding:4px 0}
  .rt td::before{content:attr(data-label);color:var(--ink-2);font-size:12px;text-align:left;flex:none}
  .rt td.full{display:block;text-align:left}
  .rt td.empty{display:none}
  .rt td.full::before{display:block;margin-bottom:2px}
  .rt td:first-child{font-weight:600;text-align:left;display:block;padding-bottom:6px;border-bottom:1px solid var(--line);margin-bottom:4px}
  .rt td:first-child::before{display:none}
  .checks li{grid-template-columns:22px 1fr}
  .checks .act{grid-column:2;grid-row:auto;text-align:left}
  .checks .st{grid-column:2;grid-row:auto;text-align:left}
  .watermark-bg span{font-size:18vw}
}
@media print{
  @page{margin:12mm}
  body{background:#fff;font-size:11.5px}
  .wrap{max-width:none;padding:0}
  .verdict,.kpi,.callout,.chart,.heat-wrap,.checks li,.works li,.flags li,.dnotes li,.summary-list li,.bars,.rt tr{break-inside:avoid;box-shadow:none}
  section.card{break-inside:auto}
  section.card{border-color:#c9c8c2}
  .toc,.tooltip{display:none}
  .chart.narrow{display:none!important}.chart.wide{display:block!important}
  .scroll{overflow:visible}
  h2,h3,caption{break-after:avoid}
  tr{break-inside:avoid}
  a{color:inherit;text-decoration:none}
  .watermark-bg span{color:rgba(11,11,11,.09)}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
`;

/** Hover layer for the hold chart: a crosshair snaps to the nearest year and a tooltip lists every series. */
export const SCRIPT = `(function(){
function fmt(n){return(n<0?'-':'')+'$'+Math.abs(Math.round(n)).toLocaleString('en-US');}
document.querySelectorAll('.chart[data-chart]').forEach(function(el){
var d;try{d=JSON.parse(el.getAttribute('data-chart')||'');}catch(e){return;}
var svg=el.querySelector('svg'),hit=el.querySelector('.hit'),cross=el.querySelector('.crosshair'),tip=el.querySelector('.tooltip');
if(!d||!svg||!hit||!cross||!tip)return;
function hide(){cross.setAttribute('visibility','hidden');tip.hidden=true;}
function show(ev){
var ctm=svg.getScreenCTM();if(!ctm||!svg.getBoundingClientRect().width)return;
var pt=svg.createSVGPoint();pt.x=ev.clientX;pt.y=ev.clientY;
var p=pt.matrixTransform(ctm.inverse()),best=0,bd=Infinity;
d.xs.forEach(function(x,i){var k=Math.abs(x-p.x);if(k<bd){bd=k;best=i;}});
cross.setAttribute('x1',d.xs[best]);cross.setAttribute('x2',d.xs[best]);cross.setAttribute('visibility','visible');
while(tip.firstChild)tip.removeChild(tip.firstChild);
var h=document.createElement('b');h.textContent='Year '+d.years[best];tip.appendChild(h);
d.series.forEach(function(s){var row=document.createElement('div'),dot=document.createElement('i');
dot.style.background=s.color;row.appendChild(dot);row.appendChild(document.createTextNode(s.label+': '+fmt(s.values[best])));tip.appendChild(row);});
tip.hidden=false;
var box=el.getBoundingClientRect(),sx=box.width/svg.viewBox.baseVal.width,left=d.xs[best]*sx+14;
if(left+tip.offsetWidth>box.width)left=d.xs[best]*sx-tip.offsetWidth-14;
tip.style.left=Math.max(0,left)+'px';tip.style.top=Math.max(0,ev.clientY-box.top-24)+'px';}
hit.addEventListener('pointermove',show);hit.addEventListener('pointerdown',show);
hit.addEventListener('pointerleave',hide);hit.addEventListener('pointercancel',hide);
});
})();`;
