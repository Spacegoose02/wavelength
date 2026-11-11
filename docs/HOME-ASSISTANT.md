# Home Assistant

Wavelength can show what your devices are playing in [Home Assistant](https://www.home-assistant.io/) and take
commands from it: play, pause, next, previous, seek and volume. Pause the music when the doorbell rings, turn it
down at bedtime, or put the controls on a dashboard.

It works through your [Wavelength Hub](HUB.md) and the devices you're signed in on. A device shows up while
Wavelength is open on it with **Settings → Account → Devices → Let my other devices see and control this one** on
(the same switch the Devices button uses). Home Assistant sees **your** devices only; each person in the house
connects their own.

## 1. Make a token

In Wavelength: **Settings → Account → Home Assistant → Make a Home Assistant token**. Copy the token: it's shown
only once. (Lost it? Make another one.) It shows under **Signed-in devices** as *Home Assistant*; remove it there
to cut Home Assistant off. Kid profiles can't make one.

## 2. Add it to Home Assistant

In Home Assistant's `secrets.yaml`, put the word `Bearer`, a space, and the token:

```yaml
wavelength_auth: "Bearer wlh_…"
```

Then in `configuration.yaml` (change `https://hub.example.com` to your Hub's address, shown next to the token, and
`Phone` to your device's name as it appears in Wavelength):

```yaml
rest:
  # one of these per device you want as a sensor
  - resource: https://hub.example.com/api/ha/player?name=Phone
    headers:
      Authorization: !secret wavelength_auth
    scan_interval: 10
    sensor:
      - name: Wavelength Phone
        unique_id: wavelength_phone
        value_template: "{{ value_json.state }}"
        json_attributes: [id, title, artist, album, position, duration, volume, queued]
  # how many of your devices are playing, with all of them in the attributes
  - resource: https://hub.example.com/api/ha/players
    headers:
      Authorization: !secret wavelength_auth
    scan_interval: 30
    sensor:
      - name: Wavelength players playing
        unique_id: wavelength_playing
        value_template: "{{ value_json.playing }}"
        json_attributes: [players]

rest_command:
  wavelength:
    url: "https://hub.example.com/api/ha/players/{{ player }}"
    method: post
    headers:
      Authorization: !secret wavelength_auth
    content_type: application/json
    payload: '{"action": "{{ action }}", "value": {{ value | default(0) }}}'
```

Restart Home Assistant. `sensor.wavelength_phone` is `playing`, `paused`, `idle` (open, nothing queued) or `off`
(Wavelength isn't open there), with the song in its attributes.

## 3. Use it

Call `rest_command.wavelength` with the player's `id` (from the sensor's attributes) and an `action`: `toggle`,
`play`, `pause`, `next`, `prev`, `seek` (`value` in seconds) or `volume` (`value` 0–1, or 0–100).

Pause when the doorbell rings:

```yaml
automation:
  - alias: Pause Wavelength for the doorbell
    triggers:
      - trigger: state
        entity_id: binary_sensor.doorbell
        to: "on"
    conditions:
      - condition: state
        entity_id: sensor.wavelength_phone
        state: playing
    actions:
      - action: rest_command.wavelength
        data:
          player: "{{ state_attr('sensor.wavelength_phone', 'id') }}"
          action: pause
```

A dashboard button:

```yaml
type: button
name: Play / pause
icon: mdi:play-pause
tap_action:
  action: perform-action
  perform_action: rest_command.wavelength
  data:
    player: "{{ state_attr('sensor.wavelength_phone', 'id') }}"
    action: toggle
```

(Dashboards don't fill in templates; use a script that calls `rest_command.wavelength` and point the button at it.)

To move the music from one device to another ("continue on the kitchen speaker"), post to
`/api/ha/players/<id>/handoff` with `{"to": "Kitchen"}` (a player's name or id). The other device picks up the
same queue at the same song and spot; this one pauses.

## What Home Assistant gets

Each player's name, kind of device, `state`, the song's title, artist and album, the position, length, volume and
how many songs are queued. Never a link to a song or a cover (those carry your server login) and nothing about
anyone else's devices.

## Hub API

| Route | Who | What |
|---|---|---|
| `POST /api/me/homeassistant` | signed in, not kids | `{ token, url, deviceId }`: a new token for Home Assistant (a device with the `homeassistant` platform) |
| `GET /api/ha/players` | any of your tokens | `{ playing, players: [{ id, name, platform, state, title, artist, album, position, duration, volume, queued }] }` |
| `GET /api/ha/player?name=` | any of your tokens | one of those by device name (any case), or `{ state: 'off', name }` while it isn't open |
| `POST /api/ha/players/:id` | any of your tokens | `{ action, value? }`, sent to that device like a Devices command; `404` when it isn't online |
| `POST /api/ha/players/:id/handoff` | the Home Assistant token | `{ to: <player id or name> }`: the other player picks up this one's queue at the same song and spot and plays; this one pauses. `404` when either isn't online, `409` when nothing is queued there |

The Home Assistant token can't wait for commands or report a state, so it never shows up as a player.
`hub/src/routes/remote.ts`.
