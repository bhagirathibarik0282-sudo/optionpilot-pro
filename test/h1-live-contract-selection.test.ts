import test from "node:test";
import assert from "node:assert/strict";
import { selectH1LiveContracts } from "../h1-live-contract-selection.js";

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
