import { describe, expect, test } from "bun:test";
import { updateBankDetailsSchema } from "../../apps/api/src/schemas/admin/bank";
import {
    bankAccountSchema,
    bep20AddressSchema,
    fullNameSchema,
    ifscSchema,
    isValidBankAccount,
    isValidBep20Address,
    isValidIfsc,
    isValidRecipientName,
    isValidTrc20Address,
    isValidUpiId,
    trc20AddressSchema,
    upiIdSchema,
    classifyBankWrite,
} from "../../apps/api/src/schemas/bankDetails";

describe("Payout beneficiary structural validation", () => {
    test("bank account is an opaque 8–20 digit string", () => {
        expect(isValidBankAccount("00123456")).toBe(true);
        expect(bankAccountSchema.parse(" 001234567890 ")).toBe("001234567890");
        expect(isValidBankAccount("1234567")).toBe(false);
        expect(isValidBankAccount("123456789012345678901")).toBe(false);
        expect(isValidBankAccount("1234-5678")).toBe(false);
        expect(isValidBankAccount("1234567A")).toBe(false);
    });

    test("IFSC normalizes uppercase and requires AAAA0BBBBBB", () => {
        expect(isValidIfsc("HDFC0000001")).toBe(true);
        expect(ifscSchema.parse(" hdfc0000001 ")).toBe("HDFC0000001");
        expect(isValidIfsc("HDFC1000001")).toBe(false);
        expect(isValidIfsc("HDF00000001")).toBe(false);
        expect(isValidIfsc("HDFC000001")).toBe(false);
    });

    test("recipient names allow international letters and safe punctuation", () => {
        expect(isValidRecipientName("Asha D'Souza")).toBe(true);
        expect(isValidRecipientName("Mary-Jane K.")).toBe(true);
        expect(isValidRecipientName("आरव कुमार")).toBe(true);
        expect(fullNameSchema.parse("  Asha D'Souza  ")).toBe("Asha D'Souza");
        expect(isValidRecipientName("A1 User")).toBe(false);
        expect(isValidRecipientName("...")).toBe(false);
        expect(isValidRecipientName("Jo")).toBe(false);
    });

    test("UPI requires one compact name@handle value up to 50 chars", () => {
        expect(isValidUpiId("john.doe-1@okhdfcbank")).toBe(true);
        expect(upiIdSchema.parse(" john_doe@upi ")).toBe("john_doe@upi");
        expect(isValidUpiId("john doe@upi")).toBe(false);
        expect(isValidUpiId("john@@upi")).toBe(false);
        expect(isValidUpiId("@upi")).toBe(false);
        expect(isValidUpiId(".john@upi")).toBe(false);
        expect(isValidUpiId("john@.")).toBe(false);
        expect(isValidUpiId(`a@${"b".repeat(49)}`)).toBe(false);
    });

    test("TRC20 and BEP20 retain their chain-specific regexes", () => {
        const trc20 = "TRWdq1fs8DhMR8EMJX2iD5qp5jaPuaVyaR";
        const bep20 = "0x1234567890abcdef1234567890abcdef12345678";
        expect(isValidTrc20Address(trc20)).toBe(true);
        expect(trc20AddressSchema.parse(trc20)).toBe(trc20);
        expect(isValidTrc20Address(`T${"0".repeat(33)}`)).toBe(false);
        expect(isValidBep20Address(bep20)).toBe(true);
        expect(bep20AddressSchema.parse(bep20)).toBe(bep20);
        expect(isValidBep20Address(`0x${"g".repeat(40)}`)).toBe(false);
    });

    test("admin writes use the same normalized constraints", () => {
        const parsed = updateBankDetailsSchema.parse({
            fullName: "  Asha D'Souza ",
            bankName: " State Bank of India ",
            bankAccount: "001234567890",
            ifsc: "sbin0001234",
            upiId: "asha@upi",
        });
        expect(parsed.fullName).toBe("Asha D'Souza");
        expect(parsed.bankName).toBe("State Bank of India");
        expect(parsed.ifsc).toBe("SBIN0001234");
        expect(
            updateBankDetailsSchema.safeParse({ ifsc: "SBIN1001234" }).success
        ).toBe(false);
        expect(
            updateBankDetailsSchema.safeParse({ bankAccount: "1234ABCD" })
                .success
        ).toBe(false);
    });

    test("cooldown bypass is limited to correcting invalid existing values", () => {
        expect(
            classifyBankWrite(
                { ifsc: "HDFC1000001" },
                { ifsc: "HDFC0000001" }
            )
        ).toEqual({ hasChange: true, invalidLegacyCorrectionOnly: true });

        expect(
            classifyBankWrite(
                {
                    ifsc: "HDFC1000001",
                    bankAccount: "001234567890",
                },
                {
                    ifsc: "HDFC0000001",
                    bankAccount: "009999999999",
                }
            )
        ).toEqual({ hasChange: true, invalidLegacyCorrectionOnly: false });

        expect(
            classifyBankWrite(
                { ifsc: "hdfc0000001", bankName: null },
                { ifsc: "HDFC0000001", bankName: "HDFC BANK" }
            )
        ).toEqual({ hasChange: false, invalidLegacyCorrectionOnly: false });
    });
});
