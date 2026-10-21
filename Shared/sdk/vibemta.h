//
// Shared/sdk/vibemta.h
//
// VibeMTA fork settings (branded client + matching server build)
// This is a modified version of Multi Theft Auto: San Andreas (https://github.com/multitheftauto/mtasa-blue), GPLv3.
//
#pragma once

#define VIBEMTA 1

#define VIBEMTA_PRODUCT_NAME    "VibeMTA"
#define VIBEMTA_WINDOW_TITLE    "VibeMTA"
#define VIBEMTA_WINDOW_TITLE_W  L"VibeMTA"

// Default server: used when the client is started without an mtasa:// address
#define VIBEMTA_DEFAULT_HOST    "127.0.0.1"
#define VIBEMTA_DEFAULT_PORT    22003

// Own registry branch, so the official MTA install on the same PC is left alone
// (HKLM\Software\Multi Theft Auto: San Andreas All\<branch>). GTA:SA path stays shared via "Common".
#define VIBEMTA_REGISTRY_BRANCH "1.6-VibeMTA"
