import { describe, it, expect } from "vitest";
import { proposalAcceptButtons, proposalVoteButtons } from "./meetingProposal";
import { decodeCallback, screenButtons } from "./colleagues";

// Кнопки под предложением другого времени несут id РЕПЛИКИ (uuid, 36
// знаков), а не короткий id встречи. Telegram режет callback_data на 64
// байтах и молча отвергает сообщение с длинной кнопкой — то есть
// предложение просто не дошло бы. Проверяется самый длинный случай: со
// знаком экрана.
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("кнопки предложения времени", () => {
  it("влезают в 64 байта и разбираются обратно", () => {
    const all = [...proposalVoteButtons(UUID), ...proposalAcceptButtons(UUID)].flat();
    for (const b of screenButtons([all]).flat()) {
      expect(new TextEncoder().encode(b.data).length).toBeLessThanOrEqual(64);
      const back = decodeCallback(b.data);
      expect(back?.kind).toBe("meeting");
      expect(back?.id).toBe(UUID);
    }
    expect(all.map((b) => decodeCallback(b.data)?.action)).toEqual(["pyes", "pno", "pacc"]);
  });
});
