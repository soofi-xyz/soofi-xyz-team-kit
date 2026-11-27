import { describe, expect, it } from "vitest";

import { extractLoanTerms } from "../src/mortgage/loan-terms.mjs";

const UCSI = `DEED OF TRUST MIN 1015534-1000825874-9 MERS PHONE #: 1-888-679-6377
(B) "Lender" is EXAMPLE MORTGAGE, LLC. Lender is a Texas limited liability company.
(E) "Note" means the promissory note dated November 6, 2026, and signed by each Borrower.
The Note evidences that Borrower owes Lender FOUR HUNDRED NINE THOUSAND NINE HUNDRED AND 00/100
Dollars (U.S. $409,900.00) plus interest. Borrower has promised to pay this debt in full not later than December 1, 2056.
The following Riders are to be signed by Borrower [check box as applicable]:
[ ] Adjustable Rate Rider [X] Planned Unit Development Rider [X] V.A. Rider
Department of Veterans Affairs Title 38, United States Code
LATE CHARGE: Borrower will pay a "late charge" not exceeding 4.000% of the principal
TEXAS--Single Family--Fannie Mae/Freddie Mac UNIFORM INSTRUMENT Form 3044`;

describe("extractLoanTerms", () => {
  it("reads the uniform-instrument fields and settles prepayment by program", () => {
    const t = extractLoanTerms(UCSI);
    expect(t).toMatchObject({
      min: "101553410008258749",
      loanAmount: 409900,
      noteDate: "2026-11-06",
      maturityDate: "2056-12-01",
      termMonths: 360,
      program: "VA",
      lenderName: "EXAMPLE MORTGAGE, LLC",
      mers: true,
      prepaymentPenalty: false,
      initialRatePercent: null,
    });
    expect(t.evidence.prepaymentPenalty).toMatch(/VA loan/);
  });

  it("takes the initial rate from an adjustable-rate rider, not a late charge", () => {
    const t = extractLoanTerms(`${UCSI} ADJUSTABLE RATE RIDER The Note provides for an initial fixed interest rate of 5.875%.`);
    expect(t.initialRatePercent).toBe(5.875);
    expect(t.adjustableRate).toBe(true);
  });

  it("marks a ticked Prepayment Rider and reads revolving-credit maximums", () => {
    const rider = extractLoanTerms(`X Other(s) [specify]: Prepayment Rider. Fannie Mae/Freddie Mac UNIFORM INSTRUMENT`);
    expect(rider.prepaymentPenalty).toBe(true);
    const heloc = extractLoanTerms(`REVOLVING CREDIT DEED OF TRUST THIS Deed of Trust is made on 10/27/2026 ... shall not exceed ($208,400.00 ).`);
    expect(heloc).toMatchObject({ loanAmount: 208400, noteDate: "2026-10-27", prepaymentPenalty: null });
  });

  it("reads amounts that OCR split with spaces or wrote in other wordings", () => {
    const amount = (t) => extractLoanTerms(t).loanAmount;
    expect(amount("THIRTY-TWO THOUSAND AND 00/100 Dollars (U.S. $232, 000. 00) plus interest.")).toBe(232000);
    expect(amount("Two Hundred Eight Thousand Four Hundred Dollars and zero cents\n($ 208,400.00")).toBe(208400);
    expect(amount("shall not exceed Fifty Thousand Dollars and zero cents 50,000.00 ). That sum")).toBe(50000);
    expect(amount("to secure payment in the sum of $175,000.00 as evidenced by a Promissory Note")).toBe(175000);
  });

  it("cuts a form footer spliced into the lender name", () => {
    const t = extractLoanTerms(`"Lender" is First Horizon Bank TEXAS - Single Family - Fannie Mae/Freddie Mac UNIFORM INSTRUMENT (MERS) Form 3044. Lender is a bank`);
    expect(t.lenderName).toBe("First Horizon Bank");
  });
});
