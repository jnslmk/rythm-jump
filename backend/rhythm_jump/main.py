from fastapi import FastAPI

from rhythm_jump.api.http import router as api_router
from rhythm_jump.api.ws import router as ws_router

app = FastAPI(title='Rhythm Jump Backend')
app.include_router(api_router, prefix='/api')
app.include_router(ws_router)
