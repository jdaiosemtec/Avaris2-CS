//-----------------------------------------------------------------------------
//   cpuaff.c   (Avaris, 2.10.0)
//
//   Processor topology and core binding for the coupled parallel run.
//
//   avaris_engine -cpuinfo   prints one line per physical core:
//       CORE <index> <class> <logical processors, comma separated>
//   where class is the efficiency class reported by the system (higher = faster
//   core; Intel hybrid: performance cores 1, efficiency cores 0; all 0 on
//   processors with one kind of core), then
//       CPUS <logical processors>
//
//   cpu_bind("3,7") binds the calling process (and the threads it starts
//   later) to those logical processors; on Windows it also switches off power
//   throttling (EcoQoS), which would otherwise run a windowless process at low
//   clock speed or on the efficiency cores.  The environment variable
//   AVARIS_CPUS (same format) binds a stand-alone run (Detect benchmark).
//-----------------------------------------------------------------------------
#ifndef _WIN32
#define _GNU_SOURCE
#endif
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <windows.h>
#else
#include <sched.h>
#include <unistd.h>
#endif

static int parseList(const char* s, int* out, int max)
{
    int n = 0;
    while (s && *s && n < max)
    {
        char* e; long a = strtol(s, &e, 10), b = a;
        if (e == s) { s++; continue; }
        if (*e == '-') { s = e + 1; b = strtol(s, &e, 10); }
        for (long k = a; k <= b && n < max; k++) out[n++] = (int)k;
        s = e;
        while (*s == ',' || *s == ' ' || *s == '\n') s++;
    }
    return n;
}

int cpu_bind(const char* list)
{
    int c[1024], n = parseList(list, c, 1024), i;
    if (n <= 0) return 0;
#ifdef _WIN32
    {
        DWORD_PTR mask = 0;
        typedef BOOL (WINAPI *TSetInfo)(HANDLE, int, LPVOID, DWORD);
        struct { ULONG Version, ControlMask, StateMask; } pt = { 1, 0x1, 0 };   // PROCESS_POWER_THROTTLING_EXECUTION_SPEED off
        TSetInfo f = (TSetInfo)GetProcAddress(GetModuleHandleA("kernel32.dll"), "SetProcessInformation");
        if (f) f(GetCurrentProcess(), 4 /* ProcessPowerThrottling */, &pt, sizeof(pt));
        for (i = 0; i < n; i++) { if (c[i] < 0 || c[i] >= (int)(8 * sizeof(DWORD_PTR))) return 0; mask |= ((DWORD_PTR)1) << c[i]; }
        return SetProcessAffinityMask(GetCurrentProcess(), mask) ? n : 0;
    }
#else
    {
        cpu_set_t set; CPU_ZERO(&set);
        for (i = 0; i < n; i++) if (c[i] >= 0 && c[i] < CPU_SETSIZE) CPU_SET(c[i], &set);
        return sched_setaffinity(0, sizeof(set), &set) == 0 ? n : 0;
    }
#endif
}

#ifdef _WIN32
int cpu_printInfo(void)
{
    DWORD len = 0; char *buf, *p; int core = 0, nl = 0;
    GetLogicalProcessorInformationEx(RelationProcessorCore, NULL, &len);
    if (len == 0) return 1;
    buf = (char*)malloc(len);
    if (!buf || !GetLogicalProcessorInformationEx(RelationProcessorCore, (PSYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX)buf, &len)) { free(buf); return 1; }
    for (p = buf; p < buf + len; )
    {
        PSYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX x = (PSYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX)p;
        if (x->Relationship == RelationProcessorCore)
        {
            PROCESSOR_RELATIONSHIP* r = &x->Processor; int g, first = 1;
            printf("CORE %d %d ", core++, (int)r->EfficiencyClass);
            for (g = 0; g < r->GroupCount; g++)
            {
                KAFFINITY m = r->GroupMask[g].Mask; int b;
                for (b = 0; b < (int)(8 * sizeof(KAFFINITY)); b++) if (m & (((KAFFINITY)1) << b))
                { printf(first ? "%d" : ",%d", r->GroupMask[g].Group * 64 + b); first = 0; nl++; }
            }
            printf("\n");
        }
        p += x->Size;
    }
    free(buf);
    printf("CPUS %d\n", nl);
    return 0;
}
#else
static int readText(const char* f, char* buf, int n)
{
    FILE* fp = fopen(f, "rt"); size_t k;
    if (!fp) return 0;
    k = fread(buf, 1, n - 1, fp); fclose(fp); buf[k] = 0;
    while (k > 0 && (buf[k - 1] == '\n' || buf[k - 1] == ' ')) buf[--k] = 0;
    return (int)k;
}
int cpu_printInfo(void)
{
    int n = (int)sysconf(_SC_NPROCESSORS_CONF), i, j, core = 0, nl = 0;
    static char sib[1024][64]; static int done[1024], pcore[1024], ecore[1024], cap[1024];
    char b[8192], f[256]; int L[1024], m;
    if (n > 1024) n = 1024;
    memset(done, 0, sizeof(done)); memset(pcore, 0, sizeof(pcore)); memset(ecore, 0, sizeof(ecore));
    if (readText("/sys/devices/cpu_core/cpus", b, sizeof(b))) { m = parseList(b, L, 1024); for (j = 0; j < m; j++) if (L[j] < 1024) pcore[L[j]] = 1; }
    if (readText("/sys/devices/cpu_atom/cpus", b, sizeof(b))) { m = parseList(b, L, 1024); for (j = 0; j < m; j++) if (L[j] < 1024) ecore[L[j]] = 1; }
    for (i = 0; i < n; i++)
    {
        snprintf(f, sizeof(f), "/sys/devices/system/cpu/cpu%d/topology/thread_siblings_list", i);
        if (!readText(f, sib[i], 64)) snprintf(sib[i], 64, "%d", i);
        snprintf(f, sizeof(f), "/sys/devices/system/cpu/cpu%d/cpu_capacity", i);
        cap[i] = readText(f, b, 64) ? atoi(b) : 0;
    }
    for (i = 0; i < n; i++)
    {
        int cls;
        if (done[i]) continue;
        cls = pcore[i] ? 1 : ecore[i] ? 0 : cap[i] > 0 ? cap[i] / 128 : 0;
        printf("CORE %d %d ", core++, cls);
        m = parseList(sib[i], L, 1024);
        for (j = 0; j < m; j++) { if (L[j] < 1024) done[L[j]] = 1; printf(j ? ",%d" : "%d", L[j]); nl++; }
        printf("\n");
    }
    printf("CPUS %d\n", nl);
    return 0;
}
#endif
