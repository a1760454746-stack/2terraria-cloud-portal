# OBS/FFmpeg + SRS(WHEP) + Web Control Quickstart

This guide switches cloud gaming stream path to:

1. Video path: `Windows OBS/FFmpeg -> SRS -> Browser(WHEP)`
2. Control path: `Browser input -> portal signaling -> Windows control_host.py`

## 1) Deploy SRS on Linux

Use the 100M server for SRS.

Open ports in cloud firewall/security group:

1. `1985/tcp` (SRS API, WHEP endpoint)
2. `8080/tcp` (optional HTTP server)
3. `1935/tcp` (RTMP ingest)
4. `8000/udp` (WebRTC media)

Create `/root/srs.conf`:

```conf
listen              1935;
max_connections     1000;
daemon              off;
srs_log_tank        console;

http_server {
    enabled         on;
    listen          8080;
}

http_api {
    enabled         on;
    listen          1985;
}

rtc_server {
    enabled         on;
    listen          8000;
    candidate       __PUBLIC_IP__;
}

vhost __defaultVhost__ {
    rtc {
        enabled         on;
        rtmp_to_rtc     on;
        rtc_to_rtmp     off;
        nack            on;
        twcc            on;
    }
}
```

Run SRS:

```bash
docker rm -f srs || true
docker run --name srs --restart=always -d \
  -p 1935:1935 -p 1985:1985 -p 8080:8080 -p 8000:8000/udp \
  -v /root/srs.conf:/usr/local/srs/conf/srs.conf \
  ossrs/srs:6 \
  ./objs/srs -c conf/srs.conf
```

## 2) Push stream from Windows (FFmpeg)

Install FFmpeg with NVENC support.

1080p60 stream:

```powershell
ffmpeg -f gdigrab -framerate 60 -i desktop `
  -c:v h264_nvenc -preset p5 -tune ll -rc cbr `
  -b:v 14M -maxrate 18M -bufsize 18M -g 120 -bf 0 `
  -pix_fmt yuv420p -f flv rtmp://SRS_IP/live/game1080
```

720p60 stream:

```powershell
ffmpeg -f gdigrab -framerate 60 -i desktop `
  -vf scale=1280:720 `
  -c:v h264_nvenc -preset p5 -tune ll -rc cbr `
  -b:v 7M -maxrate 10M -bufsize 10M -g 120 -bf 0 `
  -pix_fmt yuv420p -f flv rtmp://SRS_IP/live/game720
```

You can also use OBS output to `rtmp://SRS_IP/live/game1080`.

## 3) Start control agent on Windows

In project root:

```powershell
cd C:\Users\lyk\Desktop\2terraria-cloud-portal
$env:SIGNALING_SERVER_IP="portal.qifen.xyz"
$env:SIGNALING_SERVER_PORT="3000"
py -3.14 .\control_host.py
```

`control_host.py` handles:

1. app launch/stop
2. keyboard/mouse input injection
3. device registration

## 4) Configure portal frontend (WHEP mode)

Set env before starting portal frontend/server:

```bash
VITE_STREAM_BACKEND=srs_whep
VITE_SRS_WHEP_URL_1080=http://SRS_IP:1985/rtc/v1/whep/?app=live&stream=game1080
VITE_SRS_WHEP_URL_720=http://SRS_IP:1985/rtc/v1/whep/?app=live&stream=game720
```

If only one stream exists, use:

```bash
VITE_SRS_WHEP_URL=http://SRS_IP:1985/rtc/v1/whep/?app=live&stream=game1080
```

## 5) Verify

1. Open portal page and enter cloud game.
2. Launch app (control path should work).
3. Click connect; video should be pulled by WHEP.
4. Press keys/mouse; actions should apply on Windows.

## 6) Notes

1. In WHEP mode, DataChannel file transfer is disabled.
2. If no picture:
   1. ensure FFmpeg/OBS is publishing stream first
   2. verify SRS `candidate` is public reachable IP
   3. verify UDP `8000` is open
3. If too much stutter:
   1. lower FFmpeg maxrate/bufsize
   2. use 720p stream
   3. avoid VPN on Windows host while testing
