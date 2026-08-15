/**
 * Country dialing codes for auth / OTP.
 *
 * - SMS_OTP_COUNTRY_CODES: can receive SMS OTP via Laaffic (strict).
 * - REGISTER_COUNTRY_CODES: all major codes allowed when linking a phone on
 *   email registration (no SMS) or storing E.164 on the user.
 */

export type CountryPhoneRule = {
  code: string;
  iso: string;
  name: string;
  flag: string;
  minLen: number;
  maxLen: number;
  placeholder: string;
  /** true if SMS OTP is supported for this code */
  smsOtp?: boolean;
};

/** Countries that can receive SMS OTP today */
export const SMS_OTP_COUNTRY_CODES = ["91", "92", "880"] as const;

/**
 * Major markets for phone-on-file (register with email OTP, login storage, etc.).
 * Sorted: SMS markets first, then by name in UI (FE sorts); code list is unique.
 */
const MAJOR_COUNTRY_DEFS: CountryPhoneRule[] = [
  // SMS-capable (priority)
  {
    code: "91",
    iso: "IN",
    name: "India",
    flag: "🇮🇳",
    minLen: 10,
    maxLen: 10,
    placeholder: "10-digit mobile",
    smsOtp: true,
  },
  {
    code: "92",
    iso: "PK",
    name: "Pakistan",
    flag: "🇵🇰",
    minLen: 10,
    maxLen: 10,
    placeholder: "3XXXXXXXXX",
    smsOtp: true,
  },
  {
    code: "880",
    iso: "BD",
    name: "Bangladesh",
    flag: "🇧🇩",
    minLen: 10,
    maxLen: 10,
    placeholder: "1XXXXXXXXX",
    smsOtp: true,
  },
  // Major international
  {
    code: "1",
    iso: "US",
    name: "United States / Canada",
    flag: "🇺🇸",
    minLen: 10,
    maxLen: 10,
    placeholder: "10-digit number",
  },
  {
    code: "44",
    iso: "GB",
    name: "United Kingdom",
    flag: "🇬🇧",
    minLen: 10,
    maxLen: 10,
    placeholder: "7XXXXXXXXX",
  },
  {
    code: "971",
    iso: "AE",
    name: "United Arab Emirates",
    flag: "🇦🇪",
    minLen: 9,
    maxLen: 9,
    placeholder: "5XXXXXXXX",
  },
  {
    code: "966",
    iso: "SA",
    name: "Saudi Arabia",
    flag: "🇸🇦",
    minLen: 9,
    maxLen: 9,
    placeholder: "5XXXXXXXX",
  },
  {
    code: "974",
    iso: "QA",
    name: "Qatar",
    flag: "🇶🇦",
    minLen: 8,
    maxLen: 8,
    placeholder: "8 digits",
  },
  {
    code: "965",
    iso: "KW",
    name: "Kuwait",
    flag: "🇰🇼",
    minLen: 8,
    maxLen: 8,
    placeholder: "8 digits",
  },
  {
    code: "973",
    iso: "BH",
    name: "Bahrain",
    flag: "🇧🇭",
    minLen: 8,
    maxLen: 8,
    placeholder: "8 digits",
  },
  {
    code: "968",
    iso: "OM",
    name: "Oman",
    flag: "🇴🇲",
    minLen: 8,
    maxLen: 8,
    placeholder: "8 digits",
  },
  {
    code: "961",
    iso: "LB",
    name: "Lebanon",
    flag: "🇱🇧",
    minLen: 7,
    maxLen: 8,
    placeholder: "7–8 digits",
  },
  {
    code: "20",
    iso: "EG",
    name: "Egypt",
    flag: "🇪🇬",
    minLen: 10,
    maxLen: 10,
    placeholder: "10 digits",
  },
  {
    code: "234",
    iso: "NG",
    name: "Nigeria",
    flag: "🇳🇬",
    minLen: 10,
    maxLen: 10,
    placeholder: "10 digits",
  },
  {
    code: "254",
    iso: "KE",
    name: "Kenya",
    flag: "🇰🇪",
    minLen: 9,
    maxLen: 9,
    placeholder: "7XXXXXXXX",
  },
  {
    code: "27",
    iso: "ZA",
    name: "South Africa",
    flag: "🇿🇦",
    minLen: 9,
    maxLen: 9,
    placeholder: "9 digits",
  },
  {
    code: "65",
    iso: "SG",
    name: "Singapore",
    flag: "🇸🇬",
    minLen: 8,
    maxLen: 8,
    placeholder: "8 digits",
  },
  {
    code: "60",
    iso: "MY",
    name: "Malaysia",
    flag: "🇲🇾",
    minLen: 9,
    maxLen: 10,
    placeholder: "9–10 digits",
  },
  {
    code: "62",
    iso: "ID",
    name: "Indonesia",
    flag: "🇮🇩",
    minLen: 9,
    maxLen: 12,
    placeholder: "9–12 digits",
  },
  {
    code: "63",
    iso: "PH",
    name: "Philippines",
    flag: "🇵🇭",
    minLen: 10,
    maxLen: 10,
    placeholder: "9XXXXXXXXX",
  },
  {
    code: "66",
    iso: "TH",
    name: "Thailand",
    flag: "🇹🇭",
    minLen: 9,
    maxLen: 9,
    placeholder: "9 digits",
  },
  {
    code: "84",
    iso: "VN",
    name: "Vietnam",
    flag: "🇻🇳",
    minLen: 9,
    maxLen: 10,
    placeholder: "9–10 digits",
  },
  {
    code: "86",
    iso: "CN",
    name: "China",
    flag: "🇨🇳",
    minLen: 11,
    maxLen: 11,
    placeholder: "11 digits",
  },
  {
    code: "81",
    iso: "JP",
    name: "Japan",
    flag: "🇯🇵",
    minLen: 10,
    maxLen: 11,
    placeholder: "10–11 digits",
  },
  {
    code: "82",
    iso: "KR",
    name: "South Korea",
    flag: "🇰🇷",
    minLen: 9,
    maxLen: 11,
    placeholder: "9–11 digits",
  },
  {
    code: "61",
    iso: "AU",
    name: "Australia",
    flag: "🇦🇺",
    minLen: 9,
    maxLen: 9,
    placeholder: "9 digits",
  },
  {
    code: "64",
    iso: "NZ",
    name: "New Zealand",
    flag: "🇳🇿",
    minLen: 8,
    maxLen: 10,
    placeholder: "8–10 digits",
  },
  {
    code: "49",
    iso: "DE",
    name: "Germany",
    flag: "🇩🇪",
    minLen: 10,
    maxLen: 11,
    placeholder: "10–11 digits",
  },
  {
    code: "33",
    iso: "FR",
    name: "France",
    flag: "🇫🇷",
    minLen: 9,
    maxLen: 9,
    placeholder: "9 digits",
  },
  {
    code: "39",
    iso: "IT",
    name: "Italy",
    flag: "🇮🇹",
    minLen: 9,
    maxLen: 10,
    placeholder: "9–10 digits",
  },
  {
    code: "34",
    iso: "ES",
    name: "Spain",
    flag: "🇪🇸",
    minLen: 9,
    maxLen: 9,
    placeholder: "9 digits",
  },
  {
    code: "31",
    iso: "NL",
    name: "Netherlands",
    flag: "🇳🇱",
    minLen: 9,
    maxLen: 9,
    placeholder: "9 digits",
  },
  {
    code: "7",
    iso: "RU",
    name: "Russia",
    flag: "🇷🇺",
    minLen: 10,
    maxLen: 10,
    placeholder: "10 digits",
  },
  {
    code: "90",
    iso: "TR",
    name: "Turkey",
    flag: "🇹🇷",
    minLen: 10,
    maxLen: 10,
    placeholder: "10 digits",
  },
  {
    code: "55",
    iso: "BR",
    name: "Brazil",
    flag: "🇧🇷",
    minLen: 10,
    maxLen: 11,
    placeholder: "10–11 digits",
  },
  {
    code: "52",
    iso: "MX",
    name: "Mexico",
    flag: "🇲🇽",
    minLen: 10,
    maxLen: 10,
    placeholder: "10 digits",
  },
  {
    code: "977",
    iso: "NP",
    name: "Nepal",
    flag: "🇳🇵",
    minLen: 10,
    maxLen: 10,
    placeholder: "10 digits",
  },
  {
    code: "94",
    iso: "LK",
    name: "Sri Lanka",
    flag: "🇱🇰",
    minLen: 9,
    maxLen: 9,
    placeholder: "7XXXXXXXX",
  },
  {
    code: "95",
    iso: "MM",
    name: "Myanmar",
    flag: "🇲🇲",
    minLen: 8,
    maxLen: 10,
    placeholder: "8–10 digits",
  },
  {
    code: "855",
    iso: "KH",
    name: "Cambodia",
    flag: "🇰🇭",
    minLen: 8,
    maxLen: 9,
    placeholder: "8–9 digits",
  },
  {
    code: "856",
    iso: "LA",
    name: "Laos",
    flag: "🇱🇦",
    minLen: 8,
    maxLen: 10,
    placeholder: "8–10 digits",
  },
];

export const REGISTER_COUNTRY_CODES = MAJOR_COUNTRY_DEFS.map((c) => c.code);

/** @deprecated use REGISTER_COUNTRY_CODES — kept for older imports */
export const SUPPORTED_COUNTRY_CODES = REGISTER_COUNTRY_CODES;

export type CountryCode = string;

export const COUNTRY_PHONE_RULES: Record<string, CountryPhoneRule> =
  Object.fromEntries(MAJOR_COUNTRY_DEFS.map((c) => [c.code, c]));

export function isRegisterCountryCode(v: string): boolean {
  return v in COUNTRY_PHONE_RULES;
}

export function isSmsOtpCountryCode(v: string): boolean {
  return (SMS_OTP_COUNTRY_CODES as readonly string[]).includes(v);
}

export function isCountryCode(v: string): boolean {
  return isRegisterCountryCode(v);
}

export function digitsOnly(v: string): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** Full international digits for SMS / OTP key / new user ids */
export function buildE164(countryCode: string, nationalNumber: string): string {
  const national = digitsOnly(nationalNumber);
  return `${digitsOnly(countryCode)}${national}`;
}

export function getCountryRule(code: string): CountryPhoneRule | undefined {
  return COUNTRY_PHONE_RULES[digitsOnly(code)];
}

export function validateNationalNumber(
  countryCode: string,
  nationalNumber: string
): { ok: true; national: string } | { ok: false; message: string } {
  const rule = getCountryRule(countryCode);
  const national = digitsOnly(nationalNumber);
  if (!rule) {
    return { ok: false, message: "Unsupported country code" };
  }
  if (national.length < rule.minLen || national.length > rule.maxLen) {
    return {
      ok: false,
      message: `${rule.name} mobile must be ${rule.minLen}${
        rule.minLen === rule.maxLen ? "" : `–${rule.maxLen}`
      } digits`,
    };
  }
  return { ok: true, national };
}

export function listCountries(opts?: { smsOnly?: boolean }): CountryPhoneRule[] {
  if (opts?.smsOnly) {
    return MAJOR_COUNTRY_DEFS.filter((c) => c.smsOtp);
  }
  return MAJOR_COUNTRY_DEFS;
}
