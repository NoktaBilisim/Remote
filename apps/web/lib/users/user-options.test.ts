import { describe, expect, it } from "vitest";
import { techOptions, userOptionsPath } from "./user-options";

describe("AC-225 teknisyen seçenekleri (/users/options)", () => {
  it("AC-225: yol — tenantId yalnız verilirse sorguya eklenir", () => {
    expect(userOptionsPath()).toBe("/users/options");
    expect(userOptionsPath("01JTENA0000000000000000002")).toBe("/users/options?tenantId=01JTENA0000000000000000002");
  });

  it("AC-225: seçenekler yalnız uç yanıtından; pasif etiketli, listede olmayan seçili id 'Seçili (…)', boş yanıt boş liste", () => {
    expect(techOptions([])).toEqual([]);
    expect(
      techOptions(
        [
          { id: "A", fullName: "Ali", status: "ACTIVE" },
          { id: "B", fullName: "Veli", status: "PASSIVE" },
        ],
        "01JTECHR00000000000000000Z",
      ),
    ).toEqual([
      { value: "A", label: "Ali" },
      { value: "B", label: "Veli (pasif)" },
      { value: "01JTECHR00000000000000000Z", label: "Seçili (00000Z)" },
    ]);
    expect(techOptions([{ id: "A", fullName: "Ali", status: "ACTIVE" }], "A")).toHaveLength(1);
  });
});
