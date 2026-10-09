export async function loadWorld(id){
  if(!['farm','city','eco'].includes(id))throw new Error('Unknown map ID');
  const url=`${import.meta.env.BASE_URL}worlds/${id}.json`;
  const resp=await fetch(url);if(!resp.ok)throw new Error(`World JSON ${resp.status}`);
  const data=await resp.json();
  if(data.schemaVersion!==1||data.mapId!==id||!data.parcels.length)throw new Error('Malformed world configuration');
  const seen=new Set();for(const p of data.parcels){if(seen.has(p.id))throw new Error('Duplicate parcel ID');seen.add(p.id);}
  return data;
}
