from typing import Any, Optional
import threading

local_index: Optional[Any] = None
index_lock = threading.Lock()
index_manifest = None