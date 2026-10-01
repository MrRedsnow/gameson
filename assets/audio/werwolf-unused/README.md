# Archived Werwolf announcements

This directory preserves four original MP3 recordings as source material. They remain outside `public/`, are not requested by the game and are not precached for offline play.

| Recording | Reason it is archived |
| --- | --- |
| [Girl announcement](./Es_erwacht_das_Mädchen_Gravity_Eleven_v3_01a0396a-545f-7c45-b64d-3fbd193dd548.mp3) | The girl is not part of the Gameson role set. |
| [Elder announcement](./Es_erwacht_der_Alte_Gravity_Eleven_v3_01a0396b-66a4-79e1-8e6f-0c53b464319b.mp3) | The elder has no separate wake-up phase; announcing it would reveal the secret role. |
| [Scapegoat announcement](./Es_erwacht_der_Sündenbock_Gravity_Eleven_v3_01a0396b-afd7-7676-9cd3-9027b58a992c.mp3) | The scapegoat has no separate wake-up phase; announcing it would reveal the secret role. |
| [Village-vote announcement](./Dorfabstimmung.mp3) | An archived recording; the active day-vote phase uses [day-vote.mp3](../../../public/audio/werwolf/day-vote.mp3). |

The current role set and phases are defined in [werewolf.ts](../../../lib/werewolf.ts). Active recordings are kept in [public/audio/werwolf](../../../public/audio/werwolf/), mapped in [werewolf-audio.ts](../../../lib/werewolf-audio.ts) and precached by the [service worker](../../../public/sw.js).
