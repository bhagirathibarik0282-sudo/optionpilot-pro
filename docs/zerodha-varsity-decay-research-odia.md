# Premium Decay ଓ Moneyness — Research Note (Zerodha Varsity ଆଧାରିତ)

**ଉଦ୍ଦେଶ୍ୟ:** ପୂର୍ବର Premium Decay examination report (docs/premium-decay-examination-report.json) କୁ Zerodha Varsity ର ନିଜସ୍ୱ Options Theory material ସହିତ ମିଳାଇ verify କରିବା — ସେହି ସମାନ ଶିକ୍ଷା ସ୍ରୋତ ଯାହା ଉପରେ ଲକ୍ଷ ଲକ୍ଷ Indian trader (Kite user ସମେତ) ନିର୍ଭର କରନ୍ତି। ଏହା ଦ୍ୱାରା ଭବିଷ୍ୟତ ର implementation ଏକ ପରିଚିତ, ବିଶ୍ୱାସଯୋଗ୍ୟ definition/formula ଉପରେ ହେବ, ଏକ ନୂଆ/ଅଲଗା convention ଉପରେ ନୁହେଁ।

**ସ୍ରୋତ:** Zerodha Varsity, Module 5 "Options Theory for Professional Trading" — Theta ଓ Moneyness of Options ଅଧ୍ୟାୟ (zerodha.com/varsity/chapter/theta-2/, zerodha.com/varsity/chapter/moneyness-of-option/)। Varsity ର ନିଜସ୍ୱ material/text ପୁନଃ ପ୍ରକାଶ କରିବା ସେମାନଙ୍କ copyright notice ଅନୁସାରେ ମନା — ତେଣୁ ତଳେ ଥିବା ସବୁକିଛି ନିଜ ଭାଷାରେ ବୁଝାଇ ଲେଖା ଯାଇଛି, ସିଧା କପି ନୁହେଁ।

---

## ୧. Theta (Time Decay) ବିଷୟରେ Varsity କ'ଣ କୁହେ

- Expiry ପାଖେଇବା ସହିତ ସବୁ option ମୂଲ୍ୟ ହରାଏ, ଓ theta ହେଉଛି ପ୍ରତିଦିନ ସେହି ମୂଲ୍ୟ ହ୍ରାସର ହାର (ବାକି ସବୁ ସମାନ ରହିଲେ)।
- Premium ଦୁଇ ଭାଗରେ ବିଭକ୍ତ — Intrinsic Value + Time Value — ଓ ପ୍ରତିଦିନ theta ହେତୁ ଏହା କିଛି ମୂଲ୍ୟ ହରାଏ।
- Decay ସିଧା ରେଖା ପରି ନୁହେଁ — series ର ଆରମ୍ଭରେ (ବହୁତ ଦିନ ବାକି ଥିଲେ) ଧୀରେ ଧୀରେ, expiry ପାଖେଇଲେ ଶୀଘ୍ର। Varsity ର ନିଜସ୍ୱ ଉଦାହରଣ: 120 ଦିନ ବାକି ଥିଲାବେଳେ premium ପ୍ରାୟ 350, ମାତ୍ର 100 ଦିନ ବାକି ଥିଲାବେଳେ (କେବଳ 20 ଦିନ ପରେ) ମାତ୍ର 300 କୁ ଖସିଥିଲା — ବହୁତ କମ୍ ପରିବର୍ତ୍ତନ ବହୁତ ସମୟ ପାଇଁ। ଏହା ଆଗେ ଆମେ ଆଲୋଚନା କରିଥିବା "ଆରମ୍ଭରେ flat curve" ର ପ୍ରମାଣ।
- Seller (short position) ପାଇଁ theta ଲାଭଦାୟକ — ସେମାନଙ୍କ ଲକ୍ଷ୍ୟ ହିଁ premium ଧରି ରଖି, ପ୍ରତିଦିନ ତାହା ହ୍ରାସ ହେବାର ଲାଭ ନେବା।
- Varsity ର ନିଷ୍କର୍ଷ: series ର ଆରମ୍ଭରେ writing କଲେ ବଡ଼ time-value premium ମିଳେ ମାତ୍ର decay ଧୀର; expiry ପାଖେଇ writing କଲେ premium ଛୋଟ ମାତ୍ର decay ଶୀଘ୍ର। **ଆପଣ (buyer) ପାଇଁ ଏହାର ଓଲଟା ମାନେ** — fresh monthly (ବହୁତ ଦିନ ବାକି) ଏକ ତୁଳନାତ୍ମକ ସୁରକ୍ଷିତ entry, direction ଯାହା ବି ହେଉ ନା କାହିଁକି।
- Indian index options **European-style** — buyer ଆଗରୁ exercise କରି ପାରେ ନାହିଁ, କେବଳ expiry ପୂର୍ବରୁ square-off କରିପାରେ, ବା expiry ରେ settle ହୁଏ (Varsity ର ନିଜ author ନିଶ୍ଚିତ କରିଥିଲେ)।

## ୧.୫ Vega ଓ IV Crush ବିଷୟରେ Varsity କ'ଣ କୁହେ — ଏହା ପ୍ରକୃତ **ତୃତୀୟ କାରଣ**

ଏହା ହିଁ ସବୁଠାରୁ ଗୁରୁତ୍ୱପୂର୍ଣ୍ଣ ଅଂଶ, ଯାହା ପ୍ରାୟ ସବୁ retail trader theta ସହିତ ମିଶାଇ ଦିଅନ୍ତି — ଓ ଆପଣଙ୍କ 700-900 premium ପାଇଁ ସିଧା ପ୍ରଯୁଜ୍ୟ:

- **Vega** ମାପେ IV (Implied Volatility) ର ୧ ପଏଣ୍ଟ ପରିବର୍ତ୍ତନରେ premium କେତେ ବଦଳେ — spot ନ ବଦଳିଲେ ମଧ୍ୟ।
- **Delta/Gamma** → Intrinsic value କୁ ପ୍ରଭାବିତ କରେ (spot movement ଉପରେ ନିର୍ଭର)। **Theta/Vega** → Extrinsic/Time value କୁ ପ୍ରଭାବିତ କରେ। ଏହି split ମଧ୍ୟ Varsity ର ନିଜ author ନିଶ୍ଚିତ କରିଥିଲେ (comment thread ରେ)।
- RBI policy, Budget, election, company earnings ଭଳି ବଡ଼ event ପୂର୍ବରୁ IV ବଢ଼ିଯାଏ (uncertainty ପାଇଁ), ଓ event ପରେ ହଠାତ୍ ତଳକୁ ଖସିଯାଏ — ଏହାକୁ **"IV Crush"** କୁହାଯାଏ। ଆପଣଙ୍କ direction prediction ଠିକ୍ ଥିଲେ ମଧ୍ୟ, IV crush ହେତୁ ପ୍ରାୟ ସମ୍ପୂର୍ଣ୍ଣ intrinsic gain ନଷ୍ଟ ହୋଇପାରେ।
- **ପ୍ରାୟୋଗିକ ମାନେ:** ଆପଣଙ୍କ 700-900 ITM premium ର loss **ତିନି ଭାଗରେ** ବିଭକ୍ତ ହୋଇପାରେ — spot movement (intrinsic), theta (expected decay), ବା IV crush (event-driven)। ଏହି ତିନୋଟି raw price chart ରେ **ଏକା ପରି ଦେଖାଯାଏ** — ଏହାକୁ ଅଲଗା କରିବାକୁ ନିର୍ଦ୍ଦିଷ୍ଟ formula ଦରକାର।

## ୨. Moneyness (ITM/ATM/OTM) ଓ Intrinsic Value ବିଷୟରେ Varsity କ'ଣ କୁହେ

- **Intrinsic value** = buyer ଏବେ exercise କଲେ କେତେ ଲାଭ ପାଇବେ — ଏହା କେବେ ବି negative ହୁଏ ନାହିଁ।
- **CE ପାଇଁ:** Intrinsic = Spot − Strike। **PE ପାଇଁ:** Intrinsic = Strike − Spot।
- Intrinsic value ଥିଲେ **ITM** (In the Money), ନ ଥିଲେ **OTM** (Out of the Money), strike ≈ spot ହେଲେ **ATM** (At the Money)।
- CE ପାଇଁ: ATM ତଳେ ଥିବା ସବୁ strike ITM, ଉପରେ ଥିବା ସବୁ OTM। PE ପାଇଁ ଓଲଟା।
- Intrinsic value ବହୁତ ଅଧିକ ହେଲେ **Deep ITM**, ବହୁତ କମ୍ ହେଲେ **Deep OTM** (ଅନ୍ୟ ପାର୍ଶ୍ୱରେ)।
- ITM premium ସର୍ବଦା OTM premium ଠାରୁ ଅଧିକ ହୁଏ (intrinsic + time value ଦୁଇଟି ଥିବାରୁ)।
- **Buyer ପାଇଁ:** profit ପାଇବାକୁ option ITM ରେ ହିଁ expire ହେବା ଦରକାର — Varsity author ନିଜେ ଏହା ନିଶ୍ଚିତ କରିଥିଲେ (ATM/OTM ରେ profit ନାହିଁ)।

## ୩. OptionPilot Pro Codebase ସହିତ ତୁଳନା (verified 2026-08-09)

| Varsity concept | server.ts ରେ ସ୍ଥିତି |
|---|---|
| Premium = Intrinsic + Time value | **ନାହିଁ।** PremiumData ରେ ଏହି split ନାହିଁ। |
| Intrinsic value formula | **ନାହିଁ**, ମାତ୍ର ଯୋଡ଼ିବା ସହଜ — spot ଓ strike ଆଗରୁ ହିଁ ଅଛି। |
| ITM/ATM/OTM classification | **ଅଂଶିକ।** କେବଳ `isAtm` flag ଅଛି, `isItm`/`isOtm` ନାହିଁ। |
| Theta (instantaneous decay rate) | **ଅଛି।** `calcGreeks()` ପୂରା Black-Scholes theta ଗଣନା କରେ। |
| Non-linear decay curve | **ଦେଖାଯାଏ ନାହିଁ।** Black-Scholes formula ରେ ଏହା ଆଗରୁ ହିଁ ନିହିତ, ମାତ୍ର code ଏହାକୁ ସମୟ ସହିତ track କରେ ନାହିଁ। |
| European-style, no early exercise | ଠିକ୍ ଭାବେ ଆଗରୁ ହିଁ ମାନି ନିଆଯାଇଛି। |
| Days to expiry (Black-Scholes T) | **ଅଛି, ମାତ୍ର calendar-day ମାତ୍ର।** Varsity ର ନିଜ ଉଦାହରଣ ମଧ୍ୟ calendar-day ବ୍ୟବହାର କରେ, ତେଣୁ ଏହା "ଭୁଲ" ନୁହେଁ, ମାତ୍ର ଏକ refinement ସୁଯୋଗ। |
| Vega (IV sensitivity) | **ଅଛି।** `calcGreeks()` ରେ ଆଗରୁ ହିଁ ଗଣନା ହେଉଛି। |

## ୪. Refined ପ୍ରସ୍ତାବ

Earlier examination report ର Step 2 (Intrinsic/Extrinsic split) ଏବେ Varsity ର ନିଜସ୍ୱ formula ସହିତ ସଠିକ୍ ଭାବେ ଲେଖା ଯାଇପାରେ:

```
intrinsicValue(CE) = max(spot - strike, 0)
intrinsicValue(PE) = max(strike - spot, 0)
extrinsicValue     = premium - intrinsicValue
isItm              = intrinsicValue > 0
```

**ତିନି-ଭାଗ ର decomposition** (Section ୧.୫ ର Vega/IV-crush finding ଠାରୁ):

```
Intrinsic value ପରିବର୍ତ୍ତନ  → spot movement ହେତୁ (delta/gamma)
Theta ହେତୁ ପରିବର୍ତ୍ତନ       → ଆଶାନୁରୂପ, ସମୟ-ଆଧାରିତ decay (ଆଗରୁ ହିଁ calcGreeks ରେ ଅଛି)
Vega/IV shift ହେତୁ ପରିବର୍ତ୍ତନ → event-driven, ହଠାତ୍ ବଡ଼ ହୋଇପାରେ (ଆଗରୁ ହିଁ calcImpliedVolatility ରେ ଅଛି)
```

ଏହି ତିନୋଟି ର ଉପାଦାନ (ingredients) ଆଗରୁ ହିଁ ଅଛି ବା ଯୋଡ଼ିବା ସହଜ — କେବଳ ମିଶାଇବା ବାକି।

## ୫. ଏହି research ଯାହା ପରିବର୍ତ୍ତନ କରେ ନାହିଁ

- Holiday list (Step 1) ର ଆବଶ୍ୟକତା ପୂର୍ବ ପରି ହିଁ ରହିଛି (trading-day-aware calculation ପାଇଁ)।
- କୌଣସି ନୂଆ "engine" ଆବଶ୍ୟକ ନାହିଁ — ଏହା Feature Extraction layer ର ଏକ extension।
- Haiku boundary ପରିବର୍ତ୍ତନ ହୁଏ ନାହିଁ — ଏହା ମଧ୍ୟ କେବଳ ଏକ ଆଗରୁ-ଗଣିତ ହୋଇଥିବା ଫଳାଫଳ explain କରିବ, ଗଣନା କରିବ ନାହିଁ।
