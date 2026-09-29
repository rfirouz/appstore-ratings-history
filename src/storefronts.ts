/**
 * App Store countries and regions. The lookup API takes the two-letter code;
 * App Store Connect reports and reviews use the three-letter code.
 */
const TABLE = `
ae ARE United Arab Emirates|ag ATG Antigua and Barbuda|ai AIA Anguilla|al ALB Albania|am ARM Armenia
ao AGO Angola|ar ARG Argentina|at AUT Austria|au AUS Australia|az AZE Azerbaijan
ba BIH Bosnia and Herzegovina|bb BRB Barbados|be BEL Belgium|bf BFA Burkina Faso|bg BGR Bulgaria
bh BHR Bahrain|bj BEN Benin|bm BMU Bermuda|bn BRN Brunei|bo BOL Bolivia
br BRA Brazil|bs BHS Bahamas|bt BTN Bhutan|bw BWA Botswana|by BLR Belarus
bz BLZ Belize|ca CAN Canada|cd COD Congo (DRC)|cg COG Congo|ch CHE Switzerland
ci CIV Côte d'Ivoire|cl CHL Chile|cm CMR Cameroon|cn CHN China|co COL Colombia
cr CRI Costa Rica|cv CPV Cape Verde|cy CYP Cyprus|cz CZE Czechia|de DEU Germany
dk DNK Denmark|dm DMA Dominica|do DOM Dominican Republic|dz DZA Algeria|ec ECU Ecuador
ee EST Estonia|eg EGY Egypt|es ESP Spain|fi FIN Finland|fj FJI Fiji
fm FSM Micronesia|fr FRA France|ga GAB Gabon|gb GBR United Kingdom|gd GRD Grenada
ge GEO Georgia|gh GHA Ghana|gm GMB Gambia|gr GRC Greece|gt GTM Guatemala
gw GNB Guinea-Bissau|gy GUY Guyana|hk HKG Hong Kong|hn HND Honduras|hr HRV Croatia
hu HUN Hungary|id IDN Indonesia|ie IRL Ireland|il ISR Israel|in IND India
iq IRQ Iraq|is ISL Iceland|it ITA Italy|jm JAM Jamaica|jo JOR Jordan
jp JPN Japan|ke KEN Kenya|kg KGZ Kyrgyzstan|kh KHM Cambodia|kn KNA St. Kitts and Nevis
kr KOR South Korea|kw KWT Kuwait|ky CYM Cayman Islands|kz KAZ Kazakhstan|la LAO Laos
lb LBN Lebanon|lc LCA St. Lucia|lk LKA Sri Lanka|lr LBR Liberia|lt LTU Lithuania
lu LUX Luxembourg|lv LVA Latvia|ly LBY Libya|ma MAR Morocco|md MDA Moldova
me MNE Montenegro|mg MDG Madagascar|mk MKD North Macedonia|ml MLI Mali|mm MMR Myanmar
mn MNG Mongolia|mo MAC Macao|mr MRT Mauritania|ms MSR Montserrat|mt MLT Malta
mu MUS Mauritius|mv MDV Maldives|mw MWI Malawi|mx MEX Mexico|my MYS Malaysia
mz MOZ Mozambique|na NAM Namibia|ne NER Niger|ng NGA Nigeria|ni NIC Nicaragua
nl NLD Netherlands|no NOR Norway|np NPL Nepal|nr NRU Nauru|nz NZL New Zealand
om OMN Oman|pa PAN Panama|pe PER Peru|pg PNG Papua New Guinea|ph PHL Philippines
pk PAK Pakistan|pl POL Poland|pt PRT Portugal|pw PLW Palau|py PRY Paraguay
qa QAT Qatar|ro ROU Romania|rs SRB Serbia|ru RUS Russia|rw RWA Rwanda
sa SAU Saudi Arabia|sb SLB Solomon Islands|sc SYC Seychelles|se SWE Sweden|sg SGP Singapore
si SVN Slovenia|sk SVK Slovakia|sl SLE Sierra Leone|sn SEN Senegal|sr SUR Suriname
st STP São Tomé and Príncipe|sv SLV El Salvador|sz SWZ Eswatini|tc TCA Turks and Caicos Islands|td TCD Chad
th THA Thailand|tj TJK Tajikistan|tm TKM Turkmenistan|tn TUN Tunisia|to TON Tonga
tr TUR Türkiye|tt TTO Trinidad and Tobago|tw TWN Taiwan|tz TZA Tanzania|ua UKR Ukraine
ug UGA Uganda|us USA United States|uy URY Uruguay|uz UZB Uzbekistan|vc VCT St. Vincent and the Grenadines
ve VEN Venezuela|vg VGB British Virgin Islands|vn VNM Vietnam|vu VUT Vanuatu|xk XKS Kosovo
ye YEM Yemen|za ZAF South Africa|zm ZMB Zambia|zw ZWE Zimbabwe
`;

export type Storefront = { code: string; alpha3: string; name: string };

export const STOREFRONTS: Storefront[] = TABLE.trim()
  .split(/[|\n]/)
  .map((entry) => {
    const [code = "", alpha3 = "", ...name] = entry.trim().split(" ");
    return { code, alpha3, name: name.join(" ") };
  });

const byAlpha3 = new Map(STOREFRONTS.map((item) => [item.alpha3, item.code]));
const names = new Map(STOREFRONTS.map((item) => [item.code, item.name]));

/** Normalises "USA", "US" or "us" to the lookup code "us". */
export function countryCode(value: string): string {
  const raw = value.trim();
  if (raw.length === 3) return byAlpha3.get(raw.toUpperCase()) ?? raw.toLowerCase();
  return raw.toLowerCase();
}

export function countryName(code: string): string {
  return names.get(code) ?? code.toUpperCase();
}
