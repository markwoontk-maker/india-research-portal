// One-shot: add NSE ticker + sector entries to data/companies.json for the
// NOTEBOOKS folders that don't yet have one. No descriptions — the
// description card in the Company tab stays hidden when `desc` is absent,
// but the chart picks up window.COMPANIES[name].ticker as a fallback so
// every entry below gets a working Yahoo Finance chart.

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'data', 'companies.json');
const companies = JSON.parse(fs.readFileSync(file, 'utf8'));

// NOTEBOOKS folder name → { ticker (full Yahoo symbol), sector }
// Tickers are NSE primary listings unless flagged. Skip uncertain or
// very-recently-listed names where the symbol is still ambiguous.
const ADD = {
  // --- Adani / Aditya Birla
  'Adani Enterprises':                  { ticker: 'ADANIENT.NS',    sector: 'Conglomerate' },
  'Adani Ports and SEZ':                { ticker: 'ADANIPORTS.NS',  sector: 'Logistics · Ports' },
  'Aditya Birla Fashion and Retail':    { ticker: 'ABFRL.NS',       sector: 'Retail · Apparel' },
  // --- A
  'Aegis Logistics':                    { ticker: 'AEGISLOG.NS',    sector: 'Logistics · Liquid' },
  'AIA Engineering':                    { ticker: 'AIAENG.NS',      sector: 'Industrials · Mill Liners' },
  'Alkem Laboratories':                 { ticker: 'ALKEM.NS',       sector: 'Pharma · Generics' },
  'Amara Raja Energy and Mobility':     { ticker: 'ARE&M.NS',       sector: 'Industrials · Batteries' },
  'Apar Industries':                    { ticker: 'APARINDS.NS',    sector: 'Power · Conductors' },
  'Apollo Hospitals':                   { ticker: 'APOLLOHOSP.NS',  sector: 'Hospitals' },
  'Ashok Leyland':                      { ticker: 'ASHOKLEY.NS',    sector: 'Auto · CV' },
  'Asian Paints':                       { ticker: 'ASIANPAINT.NS',  sector: 'Paints' },
  'ASK Automotive':                     { ticker: 'ASKAUTOLTD.NS',  sector: 'Auto Components' },
  'Ather Energy':                       { ticker: 'ATHERENERG.NS',  sector: 'Auto · EV' },
  'Aurobindo Pharma':                   { ticker: 'AUROPHARMA.NS',  sector: 'Pharma · Generics' },
  // --- B
  'Bajaj Finance':                      { ticker: 'BAJFINANCE.NS',  sector: 'Financials · NBFC' },
  'Belrise Industries':                 { ticker: 'BELRISE.NS',     sector: 'Auto Components' },
  'Blue Jet Healthcare':                { ticker: 'BLUEJET.NS',     sector: 'Pharma · API' },
  'BrainBees Solutions':                { ticker: 'FIRSTCRY.NS',    sector: 'Retail · Online' },
  'Britannia Industries':               { ticker: 'BRITANNIA.NS',   sector: 'FMCG · Foods' },
  // --- C
  'Campus Activewear':                  { ticker: 'CAMPUS.NS',      sector: 'Footwear' },
  'Cartrade Tech':                      { ticker: 'CARTRADE.NS',    sector: 'Internet · Auto' },
  'CEAT':                               { ticker: 'CEATLTD.NS',     sector: 'Auto · Tyres' },
  'Cello World':                        { ticker: 'CELLO.NS',       sector: 'Consumer · Housewares' },
  'Colgate-Palmolive (India)':          { ticker: 'COLPAL.NS',      sector: 'FMCG · Oral Care' },
  'Concord Biotech':                    { ticker: 'CONCORDBIO.NS',  sector: 'Pharma · API' },
  'Container Corporation of India':     { ticker: 'CONCOR.NS',      sector: 'Logistics · Container' },
  'Cummins India':                      { ticker: 'CUMMINSIND.NS',  sector: 'Industrials · Engines' },
  'Cyient':                             { ticker: 'CYIENT.NS',      sector: 'IT Services · ER&D' },
  // --- D
  'Dabur India':                        { ticker: 'DABUR.NS',       sector: 'FMCG · Ayurveda' },
  'Dalmia Bharat':                      { ticker: 'DALBHARAT.NS',   sector: 'Cement' },
  'Dish TV':                            { ticker: 'DISHTV.NS',      sector: 'Media · DTH' },
  "Divi's Laboratories":                { ticker: 'DIVISLAB.NS',    sector: 'Pharma · API/CRAMS' },
  // --- E
  'Eicher Motors':                      { ticker: 'EICHERMOT.NS',   sector: 'Auto · 2W / CV' },
  'Emami':                              { ticker: 'EMAMILTD.NS',    sector: 'FMCG · Personal Care' },
  'Entero Healthcare':                  { ticker: 'ENTERO.NS',      sector: 'Healthcare · Distribution' },
  'EPL':                                { ticker: 'EPL.NS',         sector: 'Packaging · Tubes' },
  'Eureka Forbes':                      { ticker: 'EUREKAFORB.NS',  sector: 'Consumer Durables' },
  // --- F
  'Finolex Cables':                     { ticker: 'FINCABLES.NS',   sector: 'Industrials · Cables' },
  'Finolex Industries':                 { ticker: 'FINPIPE.NS',     sector: 'Building Materials · Pipes' },
  'Fortis Healthcare':                  { ticker: 'FORTIS.NS',      sector: 'Hospitals' },
  'FSN E-commerce Ventures':            { ticker: 'NYKAA.NS',       sector: 'Retail · Online' },
  // --- G
  'GAIL India':                         { ticker: 'GAIL.NS',        sector: 'Oil & Gas · Gas' },
  'General Insurance Corp of India':    { ticker: 'GICRE.NS',       sector: 'Insurance · Reinsurance' },
  'GMR Airports':                       { ticker: 'GMRAIRPORT.NS',  sector: 'Infrastructure · Airports' },
  'Godrej Consumer Products':           { ticker: 'GODREJCP.NS',    sector: 'FMCG · Home & Personal' },
  'Grasim Industries':                  { ticker: 'GRASIM.NS',      sector: 'Cement · Conglomerate' },
  'Gujarat Gas':                        { ticker: 'GUJGASLTD.NS',   sector: 'Oil & Gas · CGD' },
  'Gujarat Pipavav Port':               { ticker: 'GPPL.NS',        sector: 'Logistics · Ports' },
  // --- H
  'Hitachi Energy India':               { ticker: 'POWERINDIA.NS',  sector: 'Power · T&D Equipment' },
  'Honasa Consumer':                    { ticker: 'HONASA.NS',      sector: 'FMCG · D2C' },
  'Hyundai Motor India':                { ticker: 'HYUNDAI.NS',     sector: 'Auto · PV' },
  // --- I
  'ICRA':                               { ticker: 'ICRA.NS',        sector: 'Financial Services · Ratings' },
  'IndiGo':                             { ticker: 'INDIGO.NS',      sector: 'Airlines' },
  'Indigo Paints':                      { ticker: 'INDIGOPNTS.NS',  sector: 'Paints' },
  'Indus Towers':                       { ticker: 'INDUSTOWER.NS',  sector: 'Telecom · Towers' },
  'Info Edge':                          { ticker: 'NAUKRI.NS',      sector: 'Internet · Classifieds' },
  'InterGlobe Aviation':                { ticker: 'INDIGO.NS',      sector: 'Airlines' },
  'International Gemmological Institute': { ticker: 'IGIL.NS',      sector: 'Services · Gem Testing' },
  'IPCA Laboratories':                  { ticker: 'IPCALAB.NS',     sector: 'Pharma · Generics' },
  'IRB Infrastructure':                 { ticker: 'IRB.NS',         sector: 'Infrastructure · Roads' },
  'ITC':                                { ticker: 'ITC.NS',         sector: 'FMCG · Conglomerate' },
  // --- J
  'JK Cement':                          { ticker: 'JKCEMENT.NS',    sector: 'Cement' },
  'JSW Cement':                         { ticker: 'JSWCEMENT.NS',   sector: 'Cement' },
  'JSW Steel':                          { ticker: 'JSWSTEEL.NS',    sector: 'Metals · Steel' },
  'Jubilant FoodWorks':                 { ticker: 'JUBLFOOD.NS',    sector: 'QSR · Franchisee' },
  'Jubilant Ingrevia':                  { ticker: 'JUBLINGREA.NS',  sector: 'Chemicals · Specialty' },
  'Jupiter Wagons':                     { ticker: 'JWL.NS',         sector: 'Industrials · Rail Equipment' },
  // --- K
  'Kotak Mahindra Bank':                { ticker: 'KOTAKBANK.NS',   sector: 'Banks · Private' },
  // --- L
  'L&T':                                { ticker: 'LT.NS',          sector: 'EPC · Conglomerate' },
  'L&T Finance':                        { ticker: 'LTF.NS',         sector: 'Financials · NBFC' },
  'Larsen & Toubro':                    { ticker: 'LT.NS',          sector: 'EPC · Conglomerate' },
  'Lemon Tree Hotels':                  { ticker: 'LEMONTREE.NS',   sector: 'Hotels · Mid-market' },
  'LIC India':                          { ticker: 'LICI.NS',        sector: 'Insurance · Life' },
  'Lloyds Metals and Energy':           { ticker: 'LLOYDSME.NS',    sector: 'Metals · Iron Ore' },
  'LTIMindtree':                        { ticker: 'LTIM.NS',        sector: 'IT Services · Largecap' },
  // --- M
  'Marico':                             { ticker: 'MARICO.NS',      sector: 'FMCG · Hair & Foods' },
  'Max Healthcare':                     { ticker: 'MAXHEALTH.NS',   sector: 'Hospitals' },
  'Metro Brands':                       { ticker: 'METROBRAND.NS',  sector: 'Retail · Footwear' },
  'Mphasis':                            { ticker: 'MPHASIS.NS',     sector: 'IT Services · Midcap' },
  // --- N
  'Narayana Hrudayalaya':               { ticker: 'NH.NS',          sector: 'Hospitals' },
  'Navin Fluorine':                     { ticker: 'NAVINFLUOR.NS',  sector: 'Chemicals · Fluorine' },
  'NMDC':                               { ticker: 'NMDC.NS',        sector: 'Mining · Iron Ore' },
  'NTPC':                               { ticker: 'NTPC.NS',        sector: 'Power · Generation' },
  // --- O
  'Oil and Natural Gas':                { ticker: 'ONGC.NS',        sector: 'Oil & Gas · Upstream' },
  'Oil India':                          { ticker: 'OIL.NS',         sector: 'Oil & Gas · Upstream' },
  'Ola Electric':                       { ticker: 'OLAELEC.NS',     sector: 'Auto · EV' },
  'One 97 Communications':              { ticker: 'PAYTM.NS',       sector: 'Fintech · Payments' },
  'ONGC':                               { ticker: 'ONGC.NS',        sector: 'Oil & Gas · Upstream' },
  // --- P
  'Page Industries':                    { ticker: 'PAGEIND.NS',     sector: 'Apparel · Innerwear' },
  'Patanjali Foods':                    { ticker: 'PATANJALI.NS',   sector: 'FMCG · Foods' },
  'PI Industries':                      { ticker: 'PIIND.NS',       sector: 'Agrochemicals · CSM' },
  'Praj Industries':                    { ticker: 'PRAJIND.NS',     sector: 'Industrials · Bioenergy' },
  'Prestige Estates Projects':          { ticker: 'PRESTIGE.NS',    sector: 'Real Estate · Residential' },
  // --- R
  "Rainbow Children's Hospitals":       { ticker: 'RAINBOW.NS',     sector: 'Hospitals · Paediatric' },
  "Rainbow Children's Medicare":        { ticker: 'RAINBOW.NS',     sector: 'Hospitals · Paediatric' },
  'RateGain':                           { ticker: 'RATEGAIN.NS',    sector: 'SaaS · Travel Tech' },
  'Reliance Industries':                { ticker: 'RELIANCE.NS',    sector: 'Conglomerate · Energy/Telecom/Retail' },
  // --- S
  'SAMHI Hotels':                       { ticker: 'SAMHI.NS',       sector: 'Hotels · Mid-market' },
  'Samvardhana Motherson':              { ticker: 'MOTHERSON.NS',   sector: 'Auto Components' },
  'Sansera Engineering':                { ticker: 'SANSERA.NS',     sector: 'Auto Components · Forgings' },
  'Shyam Metalics & Energy':            { ticker: 'SHYAMMETL.NS',   sector: 'Metals · Long Products' },
  'Siemens Limited':                    { ticker: 'SIEMENS.NS',     sector: 'Industrials · Automation' },
  'State Bank of India':                { ticker: 'SBIN.NS',        sector: 'Banks · PSU' },
  'Sterlite Tech':                      { ticker: 'STLTECH.NS',     sector: 'Telecom · Optical Fibre' },
  'Sun Pharmaceuticals':                { ticker: 'SUNPHARMA.NS',   sector: 'Pharma · Specialty' },
  'Sun TV Network':                     { ticker: 'SUNTV.NS',       sector: 'Media · Broadcasting' },
  // --- T
  'Tata Comm':                          { ticker: 'TATACOMM.NS',    sector: 'Telecom · Enterprise' },
  'Tata Consumer Products':             { ticker: 'TATACONSUM.NS',  sector: 'FMCG · Foods/Beverages' },
  'Tata Motors':                        { ticker: 'TATAMOTORS.NS',  sector: 'Auto · PV/CV' },
  'TBO Tek':                            { ticker: 'TBOTEK.NS',      sector: 'Travel Tech · B2B' },
  'TCI Express':                        { ticker: 'TCIEXP.NS',      sector: 'Logistics · Express' },
  'TeamLease Services':                 { ticker: 'TEAMLEASE.NS',   sector: 'Services · Staffing' },
  'The Ramco Cement':                   { ticker: 'RAMCOCEM.NS',    sector: 'Cement · South' },
  'Titagarh':                           { ticker: 'TITAGARH.NS',    sector: 'Industrials · Rail Equipment' },
  'Torrent Pharmaceuticals':            { ticker: 'TORNTPHARM.NS',  sector: 'Pharma · Branded Generics' },
  'TTK Prestige':                       { ticker: 'TTKPRESTIG.NS',  sector: 'Consumer Durables · Cookware' },
  // --- V / W
  'Varroc Engineering':                 { ticker: 'VARROC.NS',      sector: 'Auto Components · Lighting' },
  'Varun Beverages':                    { ticker: 'VBL.NS',         sector: 'FMCG · Beverages (PepsiCo bottler)' },
  'Vinati Organics':                    { ticker: 'VINATIORGA.NS',  sector: 'Chemicals · Specialty' },
  'Welspun Living':                     { ticker: 'WELSPUNLIV.NS',  sector: 'Textiles · Home' },
  'Whirlpool of India':                 { ticker: 'WHIRLPOOL.NS',   sector: 'Consumer Durables · White Goods' },
};

let added = 0, skipped = 0;
for (const [name, entry] of Object.entries(ADD)) {
  if (companies[name]) { skipped++; continue; }
  companies[name] = entry;
  added++;
}

// Re-serialise one company per line so the file stays diff-friendly.
const lines = Object.entries(companies).map(([k, v]) =>
  '  ' + JSON.stringify(k) + ': ' + JSON.stringify(v));
fs.writeFileSync(file, '{\n' + lines.join(',\n') + '\n}\n');
console.log(`added ${added} tickers, skipped ${skipped} already-present`);
console.log(`total companies in companies.json: ${Object.keys(companies).length}`);
