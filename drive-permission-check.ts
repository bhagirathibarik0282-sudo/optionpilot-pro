/** Read-only permission probe. Never returns a token, file ID or Google error body. */
export async function checkDriveFilePermission(token:string,fetchImpl:typeof fetch=fetch){
 try{
  const r=await fetchImpl('https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id)',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
  if(r.status===401)return {ready:false,state:'RECONNECT_REQUIRED',reason:'GOOGLE_DRIVE_SESSION_REJECTED'};
  if(r.status===403)return {ready:false,state:'RECONNECT_REQUIRED',reason:'GOOGLE_DRIVE_PERMISSION_REQUIRED'};
  if(!r.ok)return {ready:false,state:'CHECK_FAILED',reason:'GOOGLE_DRIVE_PERMISSION_CHECK_FAILED'};
  const body=await r.json() as any;
  return Array.isArray(body?.files)?{ready:true,state:'VERIFIED',reason:null}:{ready:false,state:'CHECK_FAILED',reason:'GOOGLE_DRIVE_PERMISSION_CHECK_FAILED'};
 }catch{return {ready:false,state:'CHECK_FAILED',reason:'GOOGLE_DRIVE_PERMISSION_CHECK_FAILED'};}
}
