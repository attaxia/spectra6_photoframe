#!/usr/bin/python3
# -*- coding:utf-8 -*-

import sys
import os
import logging

# Add lib directory to path if it exists
LIB_DIR = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'lib')
if os.path.exists(LIB_DIR):
    sys.path.append(LIB_DIR)

from waveshare_epd import epd7in3e

# === SETUP LOGGING ===
logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)


def main():
    try:
        epd = epd7in3e.EPD()
        log.info("Init and clear")
        epd.init()
        epd.Clear()

    except Exception:
        log.exception("Something went wrong:")

if __name__ == "__main__":
    main()
