from typing import Any, Optional
import threading

local_index: Optional[Any] = None
index_lock = threading.Lock()
index_manifest = None

# app/state.py
local_indices = {}   # user_id -> LocalIndex