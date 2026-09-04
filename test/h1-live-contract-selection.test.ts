import test from "node:test";
import assert from "node:assert/strict";
import { selectH1LiveContracts } from "../h1-live-contract-selection.js";
import { fetchH1LiveSelectionSpots } from "../h1-live-selection-spot-rest.js";

const rows:any[]=[
 {instrument_token:1,tradingsymbol:"NIFTY26SEP25000CE",name:"NIFTY",expiry:"2026-09-08",strike:25000,instrument_type:"CE",segment:"NFO-OPT",exchange:"NFO"},
 {instrument_token:2,tradingsymbol:"NIFTY26SEP25000PE",name:"NIFTY",expiry:"2026-09-08",strike:25000,instrument_type:"PE",segment:"NFO-OPT",exchange:"NFO"},
 {instrument_token:3,tradingsymbol:"NIFTY26SEP25050CE",name:"NIFTY",expiry:"2026-09-08",strike:25050,instrument_type:"CE",segment:"NFO-OPT",exchange:"NFO"},
 {instrument_token:4,tradingsymbol:"NIFTY26SEP25050PE",name:"NIFTY",expiry:"2026-09-08",strike:25050,instrument_type:"PE",segment:"NFO-OPT",exchange:"NFO"},
];

test("selects nearest common CE/PE strike without inferring token",()=>{
 const r=selectH1LiveContracts(rows,[{symbol:"NIFTY",instrumentToken:99,exchange:"NSE",tradingsymbol:"NIFTY 50",ltp:25031,fetchedAt:new Date().toISOString()}],"2026-09-04");
 assert.equal(r.ready,true); assert.equal(r.rows[0].strike,25050); assert.equal(r.rows[0].ceInstrumentToken,3); assert.equal(r.rows[0].peInstrumentToken,4); assert.equal(r.infersTokens,false);
});

test("fails closed without common CE/PE strike",()=>{
 const r=selectH1LiveContracts(rows.filter(x=>x.instrument_type==="CE"),[{symbol:"NIFTY",instrumentToken:99,exchange:"NSE",tradingsymbol:"NIFTY 50",ltp:25031,fetchedAt:new Date().toISOString()}],"2026-09-04");
 assert.equal(r.ready,false); assert.match(r.blockers[0],/NO_COMMON_CE_PE_STRIKE/);
});

test("uses only exact observed canonical spot identities",async()=>{
 const master:any[]=[
  {instrument_token:99,tradingsymbol:"NIFTY 50",name:"NIFTY 50",instrument_type:"EQ",segment:"INDICES",exchange:"NSE"},
  {instrument_token:98,tradingsymbol:"NIFTY NEXT 50",name:"NIFTY NEXT 50",instrument_type:"EQ",segment:"INDICES",exchange:"NSE"},
  {instrument_token:97,tradingsymbol:"NIFTY BANK",name:"NIFTY BANK",instrument_type:"EQ",segment:"INDICES",exchange:"NSE"},
  {instrument_token:96,tradingsymbol:"SENSEX",name:"SENSEX",instrument_type:"EQ",segment:"INDICES",exchange:"BSE"},
 ];
 const fetchImpl:any=async(url:string)=>{
  const parsed=new URL(url);
  assert.deepEqual(parsed.searchParams.getAll("i"),["NSE:NIFTY 50","NSE:NIFTY BANK","BSE:SENSEX"]);
  return new Response(JSON.stringify({status:"success",data:{
   "NSE:NIFTY 50":{instrument_token:99,last_price:25031},
   "NSE:NIFTY BANK":{instrument_token:97,last_price:57012},
   "BSE:SENSEX":{instrument_token:96,last_price:81010},
  }}),{status:200,headers:{"content-type":"application/json"}});
 };
 const r=await fetchH1LiveSelectionSpots({rows:master,symbols:["NIFTY","BANKNIFTY","SENSEX"],apiKey:"k",accessToken:"t",fetchImpl});
 assert.equal(r.ready,true);
 assert.deepEqual(r.rows.map(x=>x.tradingsymbol),["NIFTY 50","NIFTY BANK","SENSEX"]);
 assert.equal(r.infersTokens,false);
});
