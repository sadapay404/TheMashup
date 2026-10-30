`synthetic-av.webm` is a thirty-second, locally generated 160×90 test pattern with
a 440 Hz synthetic tone. It contains VP8 video and Vorbis audio, with no external
music or artwork. It is served only when both resolver fixture mode and the
explicit `THEMASHUP_FIXTURE_VIDEO=1` test flag are enabled.

Generation (the generator is not included in or required by the app):

```sh
ffmpeg -f lavfi -i 'testsrc=size=160x90:rate=10' \
  -f lavfi -i 'sine=frequency=440:sample_rate=8000' -t 30 \
  -c:v libvpx -b:v 65k -pix_fmt yuv420p -c:a libvorbis -b:a 24k \
  -shortest -f webm synthetic-av.webm
```
