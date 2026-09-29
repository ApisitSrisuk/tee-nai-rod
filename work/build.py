import json
t=open('template.html',encoding='utf-8').read()
css=open('leaflet.css',encoding='utf-8').read()
gj=open('bkk.min.json',encoding='utf-8').read()
out=t.replace('/*__LEAFLET_CSS__*/',css).replace('/*__GEOJSON__*/null',gj)
open('../flood-map.html','w',encoding='utf-8').write(out)
open('../local.html','w',encoding='utf-8').write('<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>'+out+'</body></html>')
print(len(out.encode()))
