# backend/app/debug_routes.py
from app.main import app  # 메인 앱 가져오기
from fastapi.routing import APIRoute

def print_all_routes():
    print("=" * 50)
    print(f"{'METHOD':<10} | {'PATH':<30} | {'FUNCTION NAME'}")
    print("=" * 50)
    
    # 등록된 모든 라우트를 순회하며 출력
    for route in app.routes:
        if isinstance(route, APIRoute):
            methods = ", ".join(route.methods)
            print(f"{methods:<10} | {route.path:<30} | {route.name}")
            
    print("=" * 50)

if __name__ == "__main__":
    print_all_routes()
