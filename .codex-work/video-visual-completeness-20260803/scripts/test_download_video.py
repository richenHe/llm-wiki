from __future__ import annotations

import unittest

import download_video


class DownloadVideoTest(unittest.TestCase):
    def test_douyin_media_kind_separates_video_and_audio_urls(self) -> None:
        self.assertEqual(
            download_video.douyin_media_kind(
                "https://example.douyinvod.com/media-video-avc1/path",
                "video/mp4",
            ),
            "video",
        )
        self.assertEqual(
            download_video.douyin_media_kind(
                "https://example.douyinvod.com/media-audio-und-mp4a/path",
                "video/mp4",
            ),
            "audio",
        )

    def test_required_audio_rejects_video_only_file(self) -> None:
        probe = {"streams": [{"codec_type": "video", "codec_name": "h264"}]}
        with self.assertRaisesRegex(download_video.DownloadError, "no usable audio"):
            download_video.require_media_streams(probe, video=True, audio=True)

    def test_required_audio_accepts_merged_file(self) -> None:
        probe = {
            "streams": [
                {"codec_type": "video", "codec_name": "h264"},
                {"codec_type": "audio", "codec_name": "aac"},
            ]
        }
        download_video.require_media_streams(probe, video=True, audio=True)


if __name__ == "__main__":
    unittest.main()
