'use strict';
// Countries for the flag / capital guessing game and the "بلاد" category.
// Row: ISO code | Arabic | English | capital (Arabic) | capital (English) | extra aliases (comma) | continent | e = easy (well-known)
// Continents: as آسيا · af أفريقيا · eu أوروبا · na أمريكا الشمالية · sa أمريكا الجنوبية · oc أوقيانوسيا

const { normalize, levenshtein } = require('./arabic.js');

const RAW = `
SA|السعودية|Saudi Arabia|الرياض|Riyadh|المملكة العربية السعودية,المملكه,KSA,Kingdom of Saudi Arabia|as|e
AE|الإمارات|United Arab Emirates|أبوظبي|Abu Dhabi|الامارات العربية المتحدة,UAE,الإمارات العربية المتحدة|as|e
QA|قطر|Qatar|الدوحة|Doha||as|e
KW|الكويت|Kuwait|مدينة الكويت|Kuwait City|الكويت العاصمة|as|e
BH|البحرين|Bahrain|المنامة|Manama||as|e
OM|عمان|Oman|مسقط|Muscat|سلطنة عمان|as|e
YE|اليمن|Yemen|صنعاء|Sanaa||as|e
IQ|العراق|Iraq|بغداد|Baghdad||as|e
SY|سوريا|Syria|دمشق|Damascus|سورية|as|e
LB|لبنان|Lebanon|بيروت|Beirut||as|e
JO|الأردن|Jordan|عمّان|Amman|الاردن|as|e
PS|فلسطين|Palestine|القدس|Jerusalem||as|e
EG|مصر|Egypt|القاهرة|Cairo||af|e
LY|ليبيا|Libya|طرابلس|Tripoli||af|e
TN|تونس|Tunisia|تونس|Tunis||af|e
DZ|الجزائر|Algeria|الجزائر|Algiers||af|e
MA|المغرب|Morocco|الرباط|Rabat|المملكة المغربية|af|e
MR|موريتانيا|Mauritania|نواكشوط|Nouakchott||af|
SD|السودان|Sudan|الخرطوم|Khartoum||af|e
SS|جنوب السودان|South Sudan|جوبا|Juba||af|
SO|الصومال|Somalia|مقديشو|Mogadishu||af|
DJ|جيبوتي|Djibouti|جيبوتي|Djibouti||af|
KM|جزر القمر|Comoros|موروني|Moroni|القمر|af|
TR|تركيا|Turkey|أنقرة|Ankara|Türkiye,تركية|as|e
IR|إيران|Iran|طهران|Tehran|ايران|as|e
IL|إسرائيل|Israel|القدس|Jerusalem|اسرائيل|as|
AF|أفغانستان|Afghanistan|كابول|Kabul|افغانستان|as|e
PK|باكستان|Pakistan|إسلام آباد|Islamabad||as|e
IN|الهند|India|نيودلهي|New Delhi|دلهي|as|e
BD|بنغلاديش|Bangladesh|دكا|Dhaka|بنقلاديش|as|
LK|سريلانكا|Sri Lanka|كولومبو|Colombo|سيرلانكا|as|
NP|نيبال|Nepal|كاتماندو|Kathmandu||as|
BT|بوتان|Bhutan|تيمفو|Thimphu||as|
MV|المالديف|Maldives|ماليه|Malé|جزر المالديف|as|
CN|الصين|China|بكين|Beijing||as|e
JP|اليابان|Japan|طوكيو|Tokyo||as|e
KR|كوريا الجنوبية|South Korea|سيول|Seoul|كوريا|as|e
KP|كوريا الشمالية|North Korea|بيونغ يانغ|Pyongyang||as|e
MN|منغوليا|Mongolia|أولان باتور|Ulaanbaatar||as|
TW|تايوان|Taiwan|تايبيه|Taipei||as|
HK|هونغ كونغ|Hong Kong|فيكتوريا|Victoria|هونج كونج|as|
TH|تايلاند|Thailand|بانكوك|Bangkok||as|e
VN|فيتنام|Vietnam|هانوي|Hanoi||as|e
LA|لاوس|Laos|فيانتيان|Vientiane||as|
KH|كمبوديا|Cambodia|بنوم بنه|Phnom Penh||as|
MM|ميانمار|Myanmar|نايبيداو|Naypyidaw|بورما,Burma|as|
MY|ماليزيا|Malaysia|كوالالمبور|Kuala Lumpur||as|e
SG|سنغافورة|Singapore|سنغافورة|Singapore|سنغافوره|as|e
ID|إندونيسيا|Indonesia|جاكرتا|Jakarta|اندونيسيا|as|e
PH|الفلبين|Philippines|مانيلا|Manila||as|e
BN|بروناي|Brunei|بندر سري بغاوان|Bandar Seri Begawan||as|
TL|تيمور الشرقية|East Timor|ديلي|Dili|تيمور ليشتي,Timor-Leste|as|
KZ|كازاخستان|Kazakhstan|أستانا|Astana|كازاخستان|as|
UZ|أوزبكستان|Uzbekistan|طشقند|Tashkent|اوزبكستان|as|
TM|تركمانستان|Turkmenistan|عشق آباد|Ashgabat||as|
KG|قيرغيزستان|Kyrgyzstan|بشكيك|Bishkek|قرغيزستان|as|
TJ|طاجيكستان|Tajikistan|دوشانبي|Dushanbe||as|
AZ|أذربيجان|Azerbaijan|باكو|Baku|اذربيجان|as|
AM|أرمينيا|Armenia|يريفان|Yerevan|ارمينيا|as|
GE|جورجيا|Georgia|تبليسي|Tbilisi||as|
CY|قبرص|Cyprus|نيقوسيا|Nicosia||eu|
RU|روسيا|Russia|موسكو|Moscow||eu|e
UA|أوكرانيا|Ukraine|كييف|Kyiv|اوكرانيا,Kiev|eu|e
BY|بيلاروسيا|Belarus|مينسك|Minsk|روسيا البيضاء|eu|
PL|بولندا|Poland|وارسو|Warsaw||eu|e
CZ|التشيك|Czech Republic|براغ|Prague|تشيكيا,Czechia|eu|
SK|سلوفاكيا|Slovakia|براتيسلافا|Bratislava||eu|
HU|المجر|Hungary|بودابست|Budapest|هنغاريا|eu|
RO|رومانيا|Romania|بوخارست|Bucharest||eu|
BG|بلغاريا|Bulgaria|صوفيا|Sofia||eu|
RS|صربيا|Serbia|بلغراد|Belgrade||eu|
HR|كرواتيا|Croatia|زغرب|Zagreb||eu|
BA|البوسنة والهرسك|Bosnia and Herzegovina|سراييفو|Sarajevo|البوسنة,Bosnia|eu|e
SI|سلوفينيا|Slovenia|ليوبليانا|Ljubljana||eu|
ME|الجبل الأسود|Montenegro|بودغوريتسا|Podgorica|الجبل الاسود|eu|
MK|مقدونيا الشمالية|North Macedonia|سكوبيا|Skopje|مقدونيا,Macedonia|eu|
AL|ألبانيا|Albania|تيرانا|Tirana|البانيا|eu|e
XK|كوسوفو|Kosovo|بريشتينا|Pristina||eu|
GR|اليونان|Greece|أثينا|Athens||eu|e
IT|إيطاليا|Italy|روما|Rome|ايطاليا|eu|e
VA|الفاتيكان|Vatican City|الفاتيكان|Vatican City|الفاتيكان|eu|
SM|سان مارينو|San Marino|سان مارينو|San Marino||eu|
MT|مالطا|Malta|فاليتا|Valletta||eu|
ES|إسبانيا|Spain|مدريد|Madrid|اسبانيا|eu|e
PT|البرتغال|Portugal|لشبونة|Lisbon||eu|e
AD|أندورا|Andorra|أندورا لا فيلا|Andorra la Vella|اندورا|eu|
FR|فرنسا|France|باريس|Paris||eu|e
BE|بلجيكا|Belgium|بروكسل|Brussels||eu|e
NL|هولندا|Netherlands|أمستردام|Amsterdam|Holland,نيذرلاند|eu|e
LU|لوكسمبورغ|Luxembourg|لوكسمبورغ|Luxembourg|لوكسمبورج|eu|
DE|ألمانيا|Germany|برلين|Berlin|المانيا|eu|e
CH|سويسرا|Switzerland|برن|Bern||eu|e
AT|النمسا|Austria|فيينا|Vienna||eu|e
LI|ليختنشتاين|Liechtenstein|فادوز|Vaduz|ليشتنشتاين|eu|
MC|موناكو|Monaco|موناكو|Monaco||eu|
GB|بريطانيا|United Kingdom|لندن|London|المملكة المتحدة,UK,انجلترا,إنجلترا,England,Britain,Great Britain|eu|e
IE|أيرلندا|Ireland|دبلن|Dublin|ايرلندا,إيرلندا|eu|
IS|آيسلندا|Iceland|ريكيافيك|Reykjavik|ايسلندا,أيسلندا|eu|
NO|النرويج|Norway|أوسلو|Oslo||eu|e
SE|السويد|Sweden|ستوكهولم|Stockholm||eu|e
DK|الدنمارك|Denmark|كوبنهاغن|Copenhagen|الدانمارك|eu|e
FI|فنلندا|Finland|هلسنكي|Helsinki||eu|
EE|إستونيا|Estonia|تالين|Tallinn|استونيا|eu|
LV|لاتفيا|Latvia|ريغا|Riga||eu|
LT|ليتوانيا|Lithuania|فيلنيوس|Vilnius||eu|
MD|مولدوفا|Moldova|كيشيناو|Chisinau||eu|
US|أمريكا|United States|واشنطن|Washington|الولايات المتحدة,الولايات المتحدة الأمريكية,امريكا,USA,US,America,United States of America|na|e
CA|كندا|Canada|أوتاوا|Ottawa||na|e
MX|المكسيك|Mexico|مكسيكو سيتي|Mexico City||na|e
GT|غواتيمالا|Guatemala|غواتيمالا سيتي|Guatemala City||na|
BZ|بليز|Belize|بلموبان|Belmopan||na|
SV|السلفادور|El Salvador|سان سلفادور|San Salvador||na|
HN|هندوراس|Honduras|تيغوسيغالبا|Tegucigalpa||na|
NI|نيكاراغوا|Nicaragua|ماناغوا|Managua||na|
CR|كوستاريكا|Costa Rica|سان خوسيه|San Jose||na|
PA|بنما|Panama|بنما سيتي|Panama City||na|
CU|كوبا|Cuba|هافانا|Havana||na|e
JM|جامايكا|Jamaica|كينغستون|Kingston||na|
HT|هايتي|Haiti|بورت أو برنس|Port-au-Prince||na|
DO|جمهورية الدومينيكان|Dominican Republic|سانتو دومينغو|Santo Domingo|الدومينيكان|na|
BS|الباهاما|Bahamas|ناساو|Nassau|جزر البهاما|na|
BB|بربادوس|Barbados|بريدجتاون|Bridgetown||na|
TT|ترينيداد وتوباغو|Trinidad and Tobago|بورت أوف سبين|Port of Spain||na|
PR|بورتوريكو|Puerto Rico|سان خوان|San Juan||na|
BR|البرازيل|Brazil|برازيليا|Brasilia||sa|e
AR|الأرجنتين|Argentina|بوينس آيرس|Buenos Aires|الارجنتين|sa|e
CL|تشيلي|Chile|سانتياغو|Santiago||sa|e
UY|الأوروغواي|Uruguay|مونتيفيديو|Montevideo|اوروغواي,الاوروغواي,أوروجواي|sa|e
PY|باراغواي|Paraguay|أسونسيون|Asuncion|باراجواي|sa|
BO|بوليفيا|Bolivia|سوكري|Sucre|لاباز|sa|
PE|بيرو|Peru|ليما|Lima||sa|e
EC|الإكوادور|Ecuador|كيتو|Quito|الاكوادور|sa|
CO|كولومبيا|Colombia|بوغوتا|Bogota||sa|e
VE|فنزويلا|Venezuela|كاراكاس|Caracas||sa|
GY|غويانا|Guyana|جورج تاون|Georgetown||sa|
SR|سورينام|Suriname|باراماريبو|Paramaribo||sa|
ZA|جنوب أفريقيا|South Africa|بريتوريا|Pretoria|جنوب افريقيا|af|e
NG|نيجيريا|Nigeria|أبوجا|Abuja||af|e
GH|غانا|Ghana|أكرا|Accra||af|e
SN|السنغال|Senegal|داكار|Dakar||af|e
ML|مالي|Mali|باماكو|Bamako||af|
NE|النيجر|Niger|نيامي|Niamey||af|
TD|تشاد|Chad|نجامينا|N'Djamena||af|
BF|بوركينا فاسو|Burkina Faso|واغادوغو|Ouagadougou||af|
CI|ساحل العاج|Ivory Coast|ياموسوكرو|Yamoussoukro|كوت ديفوار,Cote d'Ivoire|af|
GN|غينيا|Guinea|كوناكري|Conakry||af|
GW|غينيا بيساو|Guinea-Bissau|بيساو|Bissau||af|
GQ|غينيا الاستوائية|Equatorial Guinea|مالابو|Malabo||af|
SL|سيراليون|Sierra Leone|فريتاون|Freetown||af|
LR|ليبيريا|Liberia|مونروفيا|Monrovia||af|
GM|غامبيا|Gambia|بانجول|Banjul||af|
CV|الرأس الأخضر|Cape Verde|برايا|Praia|كابو فيردي,Cabo Verde|af|
TG|توغو|Togo|لومي|Lome||af|
BJ|بنين|Benin|بورتو نوفو|Porto-Novo||af|
CM|الكاميرون|Cameroon|ياوندي|Yaounde||af|e
CF|أفريقيا الوسطى|Central African Republic|بانغي|Bangui|جمهورية أفريقيا الوسطى|af|
CG|الكونغو|Republic of the Congo|برازافيل|Brazzaville|جمهورية الكونغو|af|
CD|الكونغو الديمقراطية|DR Congo|كينشاسا|Kinshasa|جمهورية الكونغو الديمقراطية,DRC|af|
GA|الغابون|Gabon|ليبرفيل|Libreville||af|
AO|أنغولا|Angola|لواندا|Luanda|انجولا|af|
ET|إثيوبيا|Ethiopia|أديس أبابا|Addis Ababa|اثيوبيا|af|e
ER|إريتريا|Eritrea|أسمرة|Asmara|اريتريا|af|
KE|كينيا|Kenya|نيروبي|Nairobi||af|e
UG|أوغندا|Uganda|كمبالا|Kampala|اوغندا|af|
TZ|تنزانيا|Tanzania|دودوما|Dodoma||af|
RW|رواندا|Rwanda|كيغالي|Kigali||af|
BI|بوروندي|Burundi|جيتيغا|Gitega||af|
MW|مالاوي|Malawi|ليلونغوي|Lilongwe||af|
ZM|زامبيا|Zambia|لوساكا|Lusaka||af|
ZW|زيمبابوي|Zimbabwe|هراري|Harare||af|
MZ|موزمبيق|Mozambique|مابوتو|Maputo||af|
MG|مدغشقر|Madagascar|أنتاناناريفو|Antananarivo||af|
MU|موريشيوس|Mauritius|بورت لويس|Port Louis||af|
SC|سيشل|Seychelles|فيكتوريا|Victoria|سيشيل|af|
NA|ناميبيا|Namibia|ويندهوك|Windhoek||af|
BW|بوتسوانا|Botswana|غابورون|Gaborone||af|
SZ|إسواتيني|Eswatini|مبابان|Mbabane|سوازيلاند,Swaziland|af|
LS|ليسوتو|Lesotho|ماسيرو|Maseru||af|
ST|ساو تومي وبرينسيبي|Sao Tome and Principe|ساو تومي|Sao Tome||af|
AU|أستراليا|Australia|كانبرا|Canberra|استراليا|oc|e
NZ|نيوزيلندا|New Zealand|ويلينغتون|Wellington|نيوزيلاندا|oc|e
PG|بابوا غينيا الجديدة|Papua New Guinea|بورت مورسبي|Port Moresby||oc|
FJ|فيجي|Fiji|سوفا|Suva|فيجى|oc|
WS|ساموا|Samoa|أبيا|Apia||oc|
TO|تونغا|Tonga|نوكوألوفا|Nuku'alofa||oc|
VU|فانواتو|Vanuatu|بورت فيلا|Port Vila||oc|
SB|جزر سليمان|Solomon Islands|هونيارا|Honiara||oc|
KI|كيريباتي|Kiribati|تاراوا|Tarawa||oc|
PW|بالاو|Palau|نغيرولمود|Ngerulmud||oc|
`;

const CONTINENTS = { as: 'آسيا', af: 'أفريقيا', eu: 'أوروبا', na: 'أمريكا الشمالية والوسطى', sa: 'أمريكا الجنوبية', oc: 'أوقيانوسيا' };

// 'SA' → 🇸🇦 (regional-indicator letters; Discord draws them as the flag).
const flagEmoji = (code) => [...code.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');

const COUNTRIES = RAW.trim().split('\n').map((line) => {
  const [code, ar, en, capAr, capEn, aliases, cont, easy] = line.split('|');
  const names = [ar, en, ...(aliases ? aliases.split(',') : [])].map(s => s.trim()).filter(Boolean);
  const keys = [...new Set(names.map(normalize).filter(Boolean))];
  return { code, ar, en, capAr, capEn, continent: cont, continentAr: CONTINENTS[cont], easy: easy === 'e', flag: flagEmoji(code), keys };
}).filter(c => c.code !== 'XK' || true);

// Kosovo has no standard flag emoji on every platform; keep it out of the flag game.
const FLAGGABLE = COUNTRIES.filter(c => c.code !== 'XK' && c.code !== 'HK');

// Every normalised country AND capital name (used to validate the "بلاد" answer).
const PLACE_KEYS = new Set();
for (const c of COUNTRIES) {
  for (const k of c.keys) PLACE_KEYS.add(k);
  PLACE_KEYS.add(normalize(c.capAr)); PLACE_KEYS.add(normalize(c.capEn));
}

/**
 * Does `answer` name this country? Exact (after normalising) or ONE typo for
 * names of 6+ letters. Also accepts the capital's name? No — only the country.
 */
function matches(country, answer) {
  const a = normalize(answer);
  if (!a) return false;
  if (country.keys.includes(a)) return true;
  if (a.length >= 6) return country.keys.some(k => k.length >= 6 && Math.abs(k.length - a.length) <= 1 && levenshtein(k, a) <= 1);
  return false;
}

const isPlace = (answer) => PLACE_KEYS.has(normalize(answer));

function pick(list, n, rng = Math.random) {
  const pool = [...list];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

module.exports = { COUNTRIES, FLAGGABLE, CONTINENTS, flagEmoji, matches, isPlace, pick };
