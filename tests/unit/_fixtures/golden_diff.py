# Compares a rendered FLHA PNG to the WP0 baseline, ignoring the two places
# that legitimately differ (timestamps, the signature scribble).
import sys
import numpy as np
from PIL import Image
a = np.array(Image.open(sys.argv[1]).convert('L')).astype(int)
b = np.array(Image.open(sys.argv[2]).convert('L')).astype(int)
if a.shape != b.shape:
    print('shape', a.shape, b.shape); sys.exit(2)
d = np.abs(a - b) > 40
d[20:35, 380:] = False      # header timestamp
d[595:720, :] = False       # signature image, printed name and date
print(d.sum() / d.size)
