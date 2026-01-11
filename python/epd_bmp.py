#!/usr/bin/python
# -*- coding:utf-8 -*-
import sys
import os
picdir = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'pic')
libdir = os.path.join(os.path.dirname(os.path.realpath(__file__)), 'lib')
print(libdir)
if os.path.exists(libdir):
    sys.path.append(libdir)

import logging
from waveshare_epd import epd7in3e
import time
from PIL import Image,ImageDraw,ImageFont,ImageOps
import traceback
import requests
from io import BytesIO

logging.basicConfig(level=logging.DEBUG)

# Server configuration
SERVER_HOST = 'localhost'
SERVER_PORT = 3000

try:
    logging.info("epd7in3f Demo")

    epd = epd7in3e.EPD()   
    logging.info("init and Clear")
    epd.init()
    epd.Clear()
    
    # read bmp from server endpoint
    server_url = f'http://{SERVER_HOST}:{SERVER_PORT}/bmp'
    logging.info(f"2.read bmp file from {server_url}")
    response = requests.get(server_url)
    response.raise_for_status()
    Himage = Image.open(BytesIO(response.content))
    epd.display(epd.getbuffer(Himage))
    time.sleep(3)

    logging.info("Goto Sleep...")
    epd.sleep()
        
except IOError as e:
    logging.info(e)
    
except KeyboardInterrupt:    
    logging.info("ctrl + c:")
    epd7in3e.epdconfig.module_exit(cleanup=True)
    exit()
