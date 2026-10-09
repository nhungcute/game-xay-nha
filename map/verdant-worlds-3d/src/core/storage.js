const KEY='terrain-builder-v1';
export function saveKey(mapId){return `${KEY}-${mapId}`;}
export function loadSaved(mapId){try{const v=localStorage.getItem(saveKey(mapId));return v?JSON.parse(v):null;}catch{return null;}}
export function persist(mapId,state){localStorage.setItem(saveKey(mapId),JSON.stringify(state));}
export function exportJSON(state,name){
  const data=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(data);
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function parseSaved(text,mapId){
  const state=JSON.parse(text);
  if(state.schemaVersion!==1||state.mapId!==mapId||!Array.isArray(state.buildings)||!state.nature)throw new Error('Invalid save or different map type');
  return state;
}
