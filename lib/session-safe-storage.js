import { createJSONStorage } from 'zustand/middleware';

// Persistence is optional. Blocked/quota-limited storage must not interrupt
// live flight when a visit, contract or automatic traffic spot is recorded.
export function sessionSafeStorage(){
 const session=new Map();
 return createJSONStorage(()=>({
  getItem(key){
   if(session.has(key))return session.get(key);
   try{return typeof window==='undefined'?null:window.localStorage.getItem(key);}catch{return null;}
  },
  setItem(key,value){
   try{if(typeof window==='undefined')return;window.localStorage.setItem(key,value);session.delete(key);}
   catch{session.set(key,value);}
  },
  removeItem(key){
   session.delete(key);try{if(typeof window!=='undefined')window.localStorage.removeItem(key);}catch{/* Session deletion still applies. */}
  },
 }));
}
