"""Compare image content across Docker classic and containerd image stores."""
import hashlib
import json
import sys

image = json.load(sys.stdin)
content = {key: image[key] for key in ('Architecture', 'Os', 'RootFS', 'Config')}
print(hashlib.sha256(json.dumps(content, sort_keys=True, separators=(',', ':')).encode()).hexdigest())
