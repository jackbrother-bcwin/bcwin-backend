import crypto from "crypto";

import * as Config from "@bcwin/config";
import { HTTP_STATUS } from "./http";
import Logger from "@bcwin/logger";

const logger = new Logger("otp");

const getOtpStatusName = (statusValue: string): string => {
    const entry = Object.entries(OtpStatus).find(
        ([_, value]) => value === statusValue
    );
    return entry ? entry[0] : "UNKNOWN_ERROR";
};

class OtpError extends Error {
    statusCode = HTTP_STATUS.SERVICE_UNAVAILABLE;
    status: string;
    reason: string;
    errorName: string;
    requestData: any;

    constructor(status: string, reason: string, requestData?: any) {
        super(`Unable to send otp: ${reason}`);

        this.status = status;
        this.reason = reason;
        this.errorName = getOtpStatusName(status);
        this.requestData = requestData;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, OtpError);
        }

        this.name = this.constructor.name;
    }

    toJSON() {
        return {
            status: this.status,
            reason: this.reason,
            name: this.errorName,
            requestData: this.requestData,
        };
    }
}

enum OtpStatus {
    SUCCESS = "0",
    AUTHENTICATION_ERROR = "-1",
    RESTRICTED_IP_ACCESS = "-2",
    SENSITIVE_CHARACTERS_IN_SMS_CONTENT = "-3",
    SMS_CONTENT_EMPTY = "-4",
    SMS_CONTENT_TOO_LONG = "-5",
    SMS_NOT_A_TEMPLATE = "-6",
    PHONE_NUMBER_EXCEEDS_LIMIT = "-7",
    PHONE_NUMBER_EMPTY = "-8",
    ABNORMAL_PHONE_NUMBER = "-9",
    INSUFFICIENT_BALANCE = "-10",
    INCORRECT_TIME_FORMAT = "-11",
    SMS_SUBMIT_FAIL = "-12",
    USER_LOCKED = "-13",
    FIELD_EMPTY_OR_QUERY_ID_ABNORMAL = "-14",
    FREQUENT_QUERY = "-15",
    TIMESTAMP_EXPIRES = "-16",
    SMS_TEMPLATE_EMPTY = "-17",
    PORT_PROGRAM_UNUSUAL = "-18",
    CONFIRM_SMS_PRICING = "-19",
    DATA_EXISTING = "-20",
    DATA_VALIDATION_EXCEPTION = "-21",
    PARAMETER_EXCEPTION = "-22",
    DATA_CAPS = "-23",
    DATA_UNEXISTING = "-24",
    OUT_OF_TIME_RANGE = "-25",
    GETTING_FEE_FAIL = "-26",
    PERIOD_TOTAL_SEND_LIMIT = "-27",
    PERIOD_PHONE_SEND_LIMIT = "-28",
}

interface OtpResponse {
    status: string;
    reason: string;
    success?: string;
    fail?: string;
    array?: {
        msgId: string;
        number: string;
        orderId: string;
    }[];
    failArray?: {
        msgId: string;
        number: string;
        orderId: string;
    }[];
}

class Otp {
    private static readonly appId = Config.env.LAAFIC_APPID;
    private static readonly apiKey = Config.env.LAAFFIC_APIKEY;
    private static readonly apiSecret = Config.env.LAAFFIC_API_SECRET;

    private static generate() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    private static sign(timestamp: string) {
        return crypto
            .createHash("md5")
            .update(this.apiKey + this.apiSecret + timestamp)
            .digest("hex");
    }

    /**
     * @param e164 Full international digits, e.g. 919876543210 (no +)
     */
    static async send(e164: string) {
        const otp = this.generate();
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const number = e164.replace(/\D/g, "");

        if (!number || number.length < 10) {
            throw new OtpError("-9", "Invalid international phone number", {
                number,
            });
        }

        const url = `https://api.laaffic.com/v3/sendSms?appId=${this.appId
            }&numbers=${number}&content=${otp}&senderId=${Config.env.DOMAIN
            }&orderId=${number.slice(-5)}`;

        const response = await fetch(url, {
            method: "GET",
            headers: {
                Sign: this.sign(timestamp),
                Timestamp: timestamp,
                "Api-Key": this.apiKey,
                "Content-Type": "application/json",
            },
        });

        const data = (await response.json()) as OtpResponse;

        if (data.status !== OtpStatus.SUCCESS) {
            throw new OtpError(data.status, data.reason, {
                url,
                number,
            });
        }

        const successArray = data.array;

        // Laaffic may return number with or without formatting — compare digits
        const ok = successArray?.some(
            (row) => row.number?.replace(/\D/g, "") === number
        );
        if (!successArray || !ok) {
            logger.error("The number is not is the laaffic success array", {
                ...data,
            });
            throw new OtpError(
                "unknown",
                "The number is not is the laaffic success array",
                {
                    url,
                    number,
                }
            );
        }

        return otp;
    }

    /**
     * Send OTP to email address using Maileroo
     */
    static async sendEmail(email: string) {
        const otp = this.generate();
        const apiKey = Config.env.MAILEROO_API_KEY;
        const fromEmail = Config.env.MAILEROO_FROM_EMAIL || `noreply@${Config.env.DOMAIN}`;

        if (!apiKey) {
            logger.warn("MAILEROO_API_KEY is not set. Generated OTP for email:", { email, otp });
            return otp;
        }

        const response = await fetch("https://smtp.maileroo.com/api/v2/emails", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "X-Api-Key": apiKey,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: {
                    address: fromEmail,
                    display_name: "BCWIN",
                },
                to: [
                    {
                        address: email,
                    },
                ],
                subject: "Your BCWIN Verification Code",
                html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BCWIN Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #110D14; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #FDE4BC;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #110D14; padding: 40px 10px;">
    <tr>
      <td align="center">
        <!-- Card Container -->
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #241E22; border: 1px solid #382E35; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
          
          <!-- Header with Logo -->
          <tr>
            <td align="center" style="padding: 32px 24px 20px 24px; background: linear-gradient(180deg, #1A1000 0%, #241E22 100%); border-bottom: 1px solid #382E35;">
              <img src="https://bcwin.club/_next/image?url=%2Fassets%2Fpng%2Fbcwin.png&w=3840&q=75" alt="BCWIN" width="160" style="display: block; max-width: 160px; height: auto;" />
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 32px 32px 24px 32px; text-align: center;">
              <h1 style="margin: 0 0 12px 0; font-size: 22px; font-weight: 700; color: #FED358; letter-spacing: 0.5px;">
                Verification Code
              </h1>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #B79C8B;">
                Use the verification code below to complete your authentication process on <strong>BCWIN</strong>.
              </p>

              <!-- OTP Box -->
              <div style="background: linear-gradient(135deg, #1A1000 0%, #2D2318 100%); border: 1px solid #A28422; border-radius: 12px; padding: 20px; margin: 0 auto 24px auto; max-width: 320px; text-align: center;">
                <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #FED358; text-shadow: 0 0 10px rgba(254, 211, 88, 0.3);">
                  ${otp}
                </span>
              </div>

              <p style="margin: 0; font-size: 13px; color: #837064; line-height: 1.5;">
                This OTP is valid for <strong style="color: #FED358;">5 minutes</strong>. Please do not share this code with anyone for your account's security.
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 32px;">
              <div style="border-top: 1px solid #3D363A;"></div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px 28px 32px; text-align: center;">
              <p style="margin: 0 0 8px 0; font-size: 12px; color: #837064;">
                If you did not request this verification code, please ignore this email.
              </p>
              <p style="margin: 0; font-size: 11px; color: #5A5145;">
                &copy; BCWIN. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
                plain: `Your BCWIN verification code is: ${otp}. This code will expire in 5 minutes.`,
            }),
        });

        if (!response.ok) {
            const errText = await response.text();
            logger.error("Failed to send OTP via Maileroo API", { email, status: response.status, error: errText });
            throw new OtpError(response.status.toString(), `Maileroo API error: ${errText}`, { email });
        }

        return otp;
    }
}

export default Otp;

// old code for authkey.io
// export const sendOtp = async (phone: string, otp: string) => {
//     const url = `https://api.authkey.io/request?authkey=${process.env.AUTHKEY_APIKEY}&mobile=${phone}&country_code=91&sender=AUTHKY&otp=${otp}&company=${process.env.DOMAIN}+account&sid=${process.env.AUTHKEY_SID}`;

//     const response = await fetch(url);

//     if (!response.ok) {
//         throw new OtpUnavailableError();
//     }

//     const data = await response.json();

//     if (data.Message != "Submitted Successfully") {
//         console.error("[OTP_ERROR]:", data);

//         throw new OtpUnableToSendOtpError();
//     }
// };
