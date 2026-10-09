/*
 * HemiSplash: Hemisphere's own window while the Setup installs, in place of NSIS's small progress box.
 * NSIS plugin (x86-unicode). Build: tools/installer-splash/build.sh -> build/x86-unicode/HemiSplash.dll
 *
 *   HemiSplash::show "<background.bmp>"
 *
 * The window lives on its own thread (it keeps painting while files are extracted), hides the installer's
 * own windows, and follows the installer's progress bar. It closes when the installer ends.
 *
 * Herald (the staff tool) builds the same source with its own texts and colours (SPLASH_* defines, see
 * tools/installer-splash/herald.mjs): its Setup looks related but clearly different.
 */
#define WIN32_LEAN_AND_MEAN
#define UNICODE
#define _UNICODE
#include <windows.h>

/* ---------------------------------------------------------------- NSIS plugin API (api.h / pluginapi.h) */
typedef struct _stack_t {
  struct _stack_t *next;
  WCHAR text[1];
} stack_t;

enum NSPIM { NSPIM_UNLOAD, NSPIM_GUIUNLOAD };
typedef UINT_PTR (*NSISPLUGINCALLBACK)(enum NSPIM);

typedef struct {
  void *exec_flags;
  int(__stdcall *ExecuteCodeSegment)(int, HWND);
  void(__stdcall *validate_filename)(LPWSTR);
  int(__stdcall *RegisterPluginCallback)(HMODULE, NSISPLUGINCALLBACK);
} extra_parameters;

static int popstring(stack_t **stacktop, WCHAR *out, int len) {
  stack_t *th;
  if (!stacktop || !*stacktop) return 1;
  th = *stacktop;
  lstrcpynW(out, th->text, len);
  *stacktop = th->next;
  GlobalFree((HGLOBAL)th);
  return 0;
}

/* ---------------------------------------------------------------- state */
#define BASE_W 520
#define BASE_H 300
#define MAX_HIDDEN 8
#define MAX_BARS 4

static HINSTANCE g_inst;
static HANDLE g_thread;
static HANDLE g_ready;
static HWND g_win;
static HBITMAP g_bg;
static int g_bgW, g_bgH;
static volatile LONG g_closing;
static BOOL g_french;
static HWND g_parent;
static HWND g_hidden[MAX_HIDDEN];
static int g_hiddenCount;
static HWND g_bars[MAX_BARS];
static int g_barCount;
static double g_shown; /* progress drawn, eased towards the real one */
static double g_target;
static int g_dpi = 96;

/* What the window says, and its colours (the launcher's by default) */
#ifndef SPLASH_TITLE
#define SPLASH_TITLE L"HEMISPHERE SMP"
#endif
#ifndef SPLASH_TITLE_COLOR
#define SPLASH_TITLE_COLOR C_GREEN_400
#endif
#ifndef SPLASH_WINDOW
#define SPLASH_WINDOW L"Hemisphere Launcher"
#endif
#ifndef SPLASH_CLASS
#define SPLASH_CLASS L"HemisphereSetupSplash"
#endif
/* SPLASH_SUBTITLE (optional): a small line under the title, in SPLASH_SUBTITLE_COLOR */

/* Hemisphere palette (Tailwind v3 values used by the launcher) */
#define C_GREEN_400 RGB(0x4a, 0xde, 0x80)
#define C_GREEN_500 RGB(0x22, 0xc5, 0x5e)
#define C_GREEN_600 RGB(0x16, 0xa3, 0x4a)
#define C_GRAY_300 RGB(0xd1, 0xd5, 0xdb)
#define C_TRACK RGB(0x2a, 0x32, 0x40)
#define C_SHADOW RGB(0x05, 0x08, 0x10)

static int S(int v) { return MulDiv(v, g_dpi, 96); }

/* ---------------------------------------------------------------- the installer's own windows */
static BOOL CALLBACK collectBars(HWND h, LPARAM lp) {
  WCHAR cls[32];
  int i;
  (void)lp;
  for (i = 0; i < g_barCount; i++)
    if (g_bars[i] == h) return TRUE;
  if (g_barCount < MAX_BARS && GetClassNameW(h, cls, 32) && lstrcmpiW(cls, L"msctls_progress32") == 0) g_bars[g_barCount++] = h;
  return TRUE;
}

/* Every visible window of this installer (main window, progress banner): hidden for good. Also run on every tick:
   a window the installer opens after the splash (shown early, from .onInit) is hidden within a frame. */
static BOOL CALLBACK collectInstallerWindows(HWND h, LPARAM lp) {
  DWORD pid = 0;
  int i;
  (void)lp;
  GetWindowThreadProcessId(h, &pid);
  if (pid != GetCurrentProcessId() || h == g_win || !IsWindowVisible(h)) return TRUE;
  for (i = 0; i < g_hiddenCount; i++)
    if (g_hidden[i] == h) return TRUE;
  if (g_hiddenCount < MAX_HIDDEN) g_hidden[g_hiddenCount++] = h;
  EnumChildWindows(h, collectBars, 0);
  return TRUE;
}

static void hideInstallerWindows(void) {
  int i;
  for (i = 0; i < g_hiddenCount; i++)
    if (IsWindow(g_hidden[i]) && IsWindowVisible(g_hidden[i])) ShowWindow(g_hidden[i], SW_HIDE);
}

/* 0..1 from the installer's progress bar(s); -1 while nothing has moved yet */
static double installerProgress(void) {
  double best = -1;
  int i;
  if (g_parent && g_barCount == 0) EnumChildWindows(g_parent, collectBars, 0);
  for (i = 0; i < g_barCount; i++) {
    DWORD_PTR pos = 0, hi = 0;
    if (!IsWindow(g_bars[i])) continue;
    if (!SendMessageTimeoutW(g_bars[i], 0x0408 /* PBM_GETPOS */, 0, 0, SMTO_ABORTIFHUNG, 50, &pos)) continue;
    if (!SendMessageTimeoutW(g_bars[i], 0x0407 /* PBM_GETRANGE */, FALSE, 0, SMTO_ABORTIFHUNG, 50, &hi)) continue;
    if ((int)hi > 0 && (int)pos > 0) {
      double r = (double)(int)pos / (double)(int)hi;
      if (r > best) best = r;
    }
  }
  return best > 1 ? 1 : best;
}

/* ---------------------------------------------------------------- painting */
static HFONT makeFont(int px, int weight) {
  return CreateFontW(-S(px), 0, 0, 0, weight, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                     CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_SWISS, L"Segoe UI");
}

static void fillRound(HDC dc, int l, int t, int r, int b, COLORREF c) {
  HBRUSH br;
  HGDIOBJ oldBr, oldPen;
  if (r - l < 1) return;
  br = CreateSolidBrush(c);
  oldBr = SelectObject(dc, br);
  oldPen = SelectObject(dc, GetStockObject(NULL_PEN));
  RoundRect(dc, l, t, r + 1, b + 1, b - t, b - t);
  SelectObject(dc, oldPen);
  SelectObject(dc, oldBr);
  DeleteObject(br);
}

static void centeredText(HDC dc, const WCHAR *s, int top, int bottom, int width, HFONT font, COLORREF color, BOOL shadow) {
  RECT rc;
  HGDIOBJ old = SelectObject(dc, font);
  if (shadow) {
    SetTextColor(dc, C_SHADOW);
    SetRect(&rc, 0, top + S(2), width, bottom + S(2));
    DrawTextW(dc, s, -1, &rc, DT_CENTER | DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX);
  }
  SetTextColor(dc, color);
  SetRect(&rc, 0, top, width, bottom);
  DrawTextW(dc, s, -1, &rc, DT_CENTER | DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX);
  SelectObject(dc, old);
}

static void paint(HWND hwnd, HDC target) {
  RECT rc;
  int w, h, barL, barR, barT, barB;
  HDC dc, src;
  HBITMAP buf;
  HGDIOBJ oldBuf;
  HFONT title, status;
  WCHAR text[64];

  GetClientRect(hwnd, &rc);
  w = rc.right;
  h = rc.bottom;
  dc = CreateCompatibleDC(target);
  buf = CreateCompatibleBitmap(target, w, h);
  oldBuf = SelectObject(dc, buf);

  /* background art (logo baked in), scaled to the window */
  if (g_bg) {
    HGDIOBJ oldSrc;
    src = CreateCompatibleDC(target);
    oldSrc = SelectObject(src, g_bg);
    SetStretchBltMode(dc, HALFTONE);
    SetBrushOrgEx(dc, 0, 0, NULL);
    StretchBlt(dc, 0, 0, w, h, src, 0, 0, g_bgW, g_bgH, SRCCOPY);
    SelectObject(src, oldSrc);
    DeleteDC(src);
  } else {
    HBRUSH br = CreateSolidBrush(RGB(0x11, 0x18, 0x27));
    FillRect(dc, &rc, br);
    DeleteObject(br);
  }

  SetBkMode(dc, TRANSPARENT);
  title = makeFont(30, FW_HEAVY);
  status = makeFont(13, FW_SEMIBOLD);
  SetTextCharacterExtra(dc, S(1));
  centeredText(dc, SPLASH_TITLE, S(150), S(190), w, title, SPLASH_TITLE_COLOR, TRUE);
  SetTextCharacterExtra(dc, 0);
#ifdef SPLASH_SUBTITLE
  {
    HFONT sub = makeFont(11, FW_BOLD);
    SetTextCharacterExtra(dc, S(2));
    centeredText(dc, SPLASH_SUBTITLE, S(186), S(204), w, sub, SPLASH_SUBTITLE_COLOR, TRUE);
    SetTextCharacterExtra(dc, 0);
    DeleteObject(sub);
  }
#define STATUS_TOP 206
#else
#define STATUS_TOP 198
#endif

  if (g_target < 0)
    lstrcpyW(text, g_french ? L"Installation\x2026" : L"Installing\x2026");
  else if (g_shown >= 0.995)
    lstrcpyW(text, g_french ? L"Lancement\x2026" : L"Starting\x2026");
  else
    wsprintfW(text, g_french ? L"Installation\x2026 %d %%" : L"Installing\x2026 %d%%", (int)(g_shown * 100));
  centeredText(dc, text, S(STATUS_TOP), S(STATUS_TOP + 24), w, status, C_GRAY_300, TRUE);

  /* progress bar: Hemisphere green on a dark track; a sliding segment until the first progress arrives */
  barL = S(70);
  barR = w - S(70);
  barT = S(STATUS_TOP + 40);
  barB = barT + S(6);
  fillRound(dc, barL, barT, barR, barB, C_TRACK);
  if (g_target < 0) {
    int span = barR - barL, seg = span / 3;
    int x = barL - seg + (int)((GetTickCount() % 1400) * (span + seg) / 1400);
    int l = x < barL ? barL : x, r = x + seg > barR ? barR : x + seg;
    if (r > l) fillRound(dc, l, barT, r, barB, C_GREEN_500);
  } else {
    int r = barL + (int)((barR - barL) * g_shown);
    if (r - barL >= barB - barT) {
      TRIVERTEX v[2] = {{barL, barT, 0x1600, 0xa300, 0x4a00, 0}, {r, barB, 0x4a00, 0xde00, 0x8000, 0}};
      GRADIENT_RECT g = {0, 1};
      HRGN clip = CreateRoundRectRgn(barL, barT, r + 1, barB + 1, barB - barT, barB - barT);
      SelectClipRgn(dc, clip);
      GradientFill(dc, v, 2, &g, 1, GRADIENT_FILL_RECT_H);
      SelectClipRgn(dc, NULL);
      DeleteObject(clip);
    } else if (r > barL) {
      fillRound(dc, barL, barT, r, barB, C_GREEN_600);
    }
  }

  BitBlt(target, 0, 0, w, h, dc, 0, 0, SRCCOPY);
  DeleteObject(title);
  DeleteObject(status);
  SelectObject(dc, oldBuf);
  DeleteObject(buf);
  DeleteDC(dc);
}

/* ---------------------------------------------------------------- window */
static void placeWindow(HWND hwnd) {
  MONITORINFO mi;
  HMONITOR mon = MonitorFromWindow(g_parent ? g_parent : hwnd, MONITOR_DEFAULTTOPRIMARY);
  int w = S(BASE_W), h = S(BASE_H);
  ZeroMemory(&mi, sizeof(mi));
  mi.cbSize = sizeof(mi);
  GetMonitorInfoW(mon, &mi);
  SetWindowPos(hwnd, NULL, mi.rcWork.left + (mi.rcWork.right - mi.rcWork.left - w) / 2, mi.rcWork.top + (mi.rcWork.bottom - mi.rcWork.top - h) / 2, w, h,
               SWP_NOZORDER | SWP_NOACTIVATE);
}

static LRESULT CALLBACK wndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
    case WM_TIMER: {
      double p;
      if (!g_closing) EnumWindows(collectInstallerWindows, 0);
      p = installerProgress();
      hideInstallerWindows();
      if (p >= 0) {
        if (g_target < 0) g_shown = 0;
        g_target = p;
        g_shown += (g_target - g_shown) * 0.18;
        if (g_target - g_shown < 0.002) g_shown = g_target;
      }
      InvalidateRect(hwnd, NULL, FALSE);
      return 0;
    }
    case WM_PAINT: {
      PAINTSTRUCT ps;
      HDC dc = BeginPaint(hwnd, &ps);
      paint(hwnd, dc);
      EndPaint(hwnd, &ps);
      return 0;
    }
    case WM_ERASEBKGND:
      return 1;
    case WM_NCHITTEST:
      return HTCAPTION; /* drag it anywhere */
    case 0x02E0: { /* WM_DPICHANGED */
      RECT *r = (RECT *)lp;
      g_dpi = HIWORD(wp);
      SetWindowPos(hwnd, NULL, r->left, r->top, r->right - r->left, r->bottom - r->top, SWP_NOZORDER | SWP_NOACTIVATE);
      return 0;
    }
    case WM_CLOSE:
      if (g_closing) DestroyWindow(hwnd); /* Alt+F4 doesn't stop an install */
      return 0;
    case WM_DESTROY:
      KillTimer(hwnd, 1);
      PostQuitMessage(0);
      return 0;
  }
  return DefWindowProcW(hwnd, msg, wp, lp);
}

static DWORD WINAPI splashThread(LPVOID unused) {
  WNDCLASSEXW wc;
  HMODULE user32 = GetModuleHandleW(L"user32.dll");
  HMODULE dwm;
  MSG m;
  (void)unused;
  ZeroMemory(&wc, sizeof(wc));
  wc.cbSize = sizeof(wc);

  /* sharp on high-DPI screens (Windows 10 1607+; older systems scale the window instead) */
  {
    typedef HANDLE(WINAPI * SetCtx)(HANDLE);
    SetCtx set = (SetCtx)GetProcAddress(user32, "SetThreadDpiAwarenessContext");
    if (set) set((HANDLE)(INT_PTR)-4 /* PER_MONITOR_AWARE_V2 */);
  }

  wc.style = CS_DROPSHADOW;
  wc.lpfnWndProc = wndProc;
  wc.hInstance = g_inst;
  wc.hCursor = LoadCursorW(NULL, (LPCWSTR)IDC_ARROW);
  wc.hIcon = LoadIconW(GetModuleHandleW(NULL), MAKEINTRESOURCEW(103)); /* the Setup's icon */
  wc.lpszClassName = SPLASH_CLASS;
  RegisterClassExW(&wc);

#ifdef SPLASH_TOPMOST
  /* above the installer's own windows from the start (shown from .onInit, before they exist) */
  g_win = CreateWindowExW(WS_EX_APPWINDOW | WS_EX_TOPMOST, wc.lpszClassName, SPLASH_WINDOW, WS_POPUP, 0, 0, BASE_W, BASE_H, NULL, NULL, g_inst, NULL);
#else
  g_win = CreateWindowExW(WS_EX_APPWINDOW, wc.lpszClassName, SPLASH_WINDOW, WS_POPUP, 0, 0, BASE_W, BASE_H, NULL, NULL, g_inst, NULL);
#endif
  if (!g_win) {
    SetEvent(g_ready);
    return 0;
  }
  {
    typedef UINT(WINAPI * GetDpi)(HWND);
    GetDpi get = (GetDpi)GetProcAddress(user32, "GetDpiForWindow");
    if (get && get(g_win)) g_dpi = (int)get(g_win);
  }
  /* rounded corners on Windows 11 */
  dwm = LoadLibraryW(L"dwmapi.dll");
  if (dwm) {
    typedef HRESULT(WINAPI * SetAttr)(HWND, DWORD, LPCVOID, DWORD);
    SetAttr set = (SetAttr)GetProcAddress(dwm, "DwmSetWindowAttribute");
    int round = 2; /* DWMWCP_ROUND */
    if (set) set(g_win, 33 /* DWMWA_WINDOW_CORNER_PREFERENCE */, &round, sizeof(round));
  }
  placeWindow(g_win);
  SetTimer(g_win, 1, 33, NULL);
  ShowWindow(g_win, SW_SHOW);
  SetForegroundWindow(g_win);
  UpdateWindow(g_win);
  SetEvent(g_ready);

  while (GetMessageW(&m, NULL, 0, 0) > 0) {
    TranslateMessage(&m);
    DispatchMessageW(&m);
  }
  g_win = NULL;
  if (dwm) FreeLibrary(dwm);
  UnregisterClassW(wc.lpszClassName, g_inst);
  return 0;
}

static void closeSplash(void) {
  if (!g_thread) return;
  InterlockedExchange(&g_closing, 1);
  if (g_win) PostMessageW(g_win, WM_CLOSE, 0, 0);
  WaitForSingleObject(g_thread, 2000);
  CloseHandle(g_thread);
  g_thread = NULL;
  if (g_bg) DeleteObject(g_bg);
  g_bg = NULL;
}

static UINT_PTR pluginCallback(enum NSPIM msg) {
  (void)msg;
  closeSplash(); /* the installer is ending */
  return 0;
}

/* ---------------------------------------------------------------- exports */
__declspec(dllexport) void __cdecl show(HWND hwndParent, int string_size, LPWSTR variables, stack_t **stacktop, extra_parameters *extra) {
  WCHAR path[MAX_PATH];
  (void)variables;
  if (popstring(stacktop, path, string_size < MAX_PATH ? string_size : MAX_PATH)) path[0] = 0;
  if (g_thread) return;
  /* stay loaded until the installer ends (the window's thread runs this DLL's code) */
  if (!extra || extra->RegisterPluginCallback(g_inst, pluginCallback) < 0) return;

  g_parent = hwndParent;
  g_french = PRIMARYLANGID(GetUserDefaultUILanguage()) == LANG_FRENCH;
  g_target = -1;
  g_shown = 0;
  if (path[0]) {
    BITMAP bm;
    g_bg = (HBITMAP)LoadImageW(NULL, path, IMAGE_BITMAP, 0, 0, LR_LOADFROMFILE | LR_CREATEDIBSECTION);
    if (g_bg && GetObjectW(g_bg, sizeof(bm), &bm)) {
      g_bgW = bm.bmWidth;
      g_bgH = bm.bmHeight;
    }
  }
  g_hiddenCount = g_barCount = 0;
  EnumWindows(collectInstallerWindows, 0);

  g_ready = CreateEventW(NULL, TRUE, FALSE, NULL);
  g_thread = CreateThread(NULL, 0, splashThread, NULL, 0, NULL);
  if (g_thread) WaitForSingleObject(g_ready, 3000);
  CloseHandle(g_ready);
  if (g_win) hideInstallerWindows(); /* no splash (very old Windows?): the usual progress box stays */
}

BOOL WINAPI DllMain(HINSTANCE inst, DWORD reason, LPVOID reserved) {
  (void)reserved;
  if (reason == DLL_PROCESS_ATTACH) g_inst = inst;
  return TRUE;
}
