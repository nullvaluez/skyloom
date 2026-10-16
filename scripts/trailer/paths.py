"""Where the trailer pipeline reads and writes. Everything generated lives in
TRAILER_WORK (default <repo>/.trailer-work, git-ignored)."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
WORK = os.environ.get('TRAILER_WORK', os.path.join(REPO, '.trailer-work'))
FONTS = os.path.join(WORK, 'fonts')
GEO = os.path.join(WORK, 'geo')
SEG = os.path.join(WORK, 'segments')
FLEET_FRAMES = os.path.join(WORK, 'fleet_frames')
# the reference cut the new trailer is edited from (1920x1080, 30 fps, 2:1 active picture)
SRC = os.environ.get('TRAILER_SRC', os.path.join(WORK, 'skyloom-trailer-final-1080p.mp4'))
