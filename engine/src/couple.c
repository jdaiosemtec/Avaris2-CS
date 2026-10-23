//-----------------------------------------------------------------------------
//   couple.c
//
//   Avaris coupled parallel run of a partitioned model.
//
//   The master model was cut into sub-models (Avaris2 CS > Partition Model).
//   At every cut, the cut conduit stays in the upstream sub-model and ends at
//   a boundary outfall; its downstream node keeps its place in the downstream
//   sub-model.  Each sub-model runs in its own process; the processes share
//   one memory block and advance together:
//
//     - every routing step all sub-models take the SAME time step, the
//       smallest of the steps they would take on their own (= the step the
//       whole model takes);
//     - dynamic wave: the sub-models exchange values inside EVERY Picard
//       iteration of the step, exactly where the whole model would use them:
//       after the link flows, the upstream side passes the flow, surface area
//       and dQ/dH of each cut conduit to its downstream node; after the node
//       depths, the downstream side passes the node's water level back to the
//       boundary outfall (which takes it as is, no outfall rule); the step
//       ends when the nodes of ALL sub-models have converged.  The coupled
//       run therefore solves the same equations as the whole model;
//     - other routing methods: the values are exchanged once per step and the
//       volume received is reconciled with the volume sent.
//
//   Usage:
//     avaris_engine -couple  <run.cpl>        coordinator (started by the GUI)
//     avaris_engine -cplworker <run.cpl> <k>  one sub-model (started by the
//                                             coordinator)
//
//   run.cpl (tab separated):
//     AVCPL   1
//     SHM     <shared memory file>
//     MODE    <bits>
//     THREADS <threads per sub-model>
//     PART    <k> <level> <inp> <rpt> <out>
//     CPL     <upPart> <outfall ID> <conduit ID> <downPart> <node ID>
//-----------------------------------------------------------------------------
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <math.h>
#ifdef _WIN32
#include <windows.h>
#else
#include <unistd.h>
#include <fcntl.h>
#include <sched.h>
#include <signal.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <linux/futex.h>
#include <limits.h>
#endif
#include "headers.h"
#include "swmm5.h"

extern void (*CplAfterLinks)(void);
extern int  (*CplAfterNodes)(int converged);

double swmm_proposeStep(void);
int    swmm_stepFixed(double routingStep, double *elapsedTime);
int    osem_applyExtensions(const char* inpFile);
extern int AvarisSkipDetail;

#define MAXPATH 1024
#define RELAX   4.0                   // volume reconciliation (steps)

typedef struct {
    int  k, level;
    char inp[MAXPATH], rpt[MAXPATH], out[MAXPATH];
} TPartCfg;

typedef struct {
    int  up, down;
    char outId[256], linkId[256], nodeId[256];
} TCplCfg;

typedef struct {
    char     shm[MAXPATH];
    int      mode, threads, nPart, nCpl;
    TPartCfg *part;
    TCplCfg  *cpl;
} TCfg;

// ---- shared memory
typedef struct {
    volatile int    gen, count, abort, beat;
    int             nPart, nCpl, pad1, pad2;
    volatile double tDays, totalDays;
    char            reserve[208];
} THdr;                               // 256 bytes

typedef struct {
    volatile int    status;           // 0 starting, 1 running, 2 done, 3 error
    volatile int    err;
    volatile int    conv;             // converged in this iteration
    volatile double dtProp[2];          // double buffered by step parity
    volatile double e1, e2, e3, secs;
    volatile long   steps;
    volatile double vol[4];           // volume through the cuts (ft3): received +/-, sent +/-
    char            msg[256];
} TPartRec;

typedef struct {
    volatile double q, area, dqdh, vsent, hused;   // upstream side
    volatile double h, vrecv;                      // downstream side
    volatile double pad;
} TCplVal;

static THdr*     H;
static TPartRec* R;
static TCplVal*  V;                   // [3 * nCpl]: iteration values, 2 step buffers

static size_t shmSize(int nPart, int nCpl)
{
    return sizeof(THdr) + nPart * sizeof(TPartRec) + 3 * nCpl * sizeof(TCplVal);
}

static void shmSetPtrs(void* base, int nPart, int nCpl)
{
    H = (THdr*)base;
    R = (TPartRec*)((char*)base + sizeof(THdr));
    V = (TCplVal*)((char*)R + nPart * sizeof(TPartRec));
}

double wallTime(void)
{
#ifdef _WIN32
    return GetTickCount64() / 1000.0;
#else
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec + ts.tv_nsec * 1e-9;
#endif
}


// ---- configuration
static char* nextField(char** s)
{
    char* p = *s; char* t;
    if (p == NULL) return NULL;
    t = strchr(p, '\t');
    if (t) { *t = 0; *s = t + 1; } else *s = NULL;
    t = p + strlen(p);
    while (t > p && (t[-1] == '\n' || t[-1] == '\r')) *--t = 0;
    return p;
}

#ifdef _WIN32
// the GUI writes the configuration in UTF-8; the C run-time opens files with the ANSI code page. Paths are turned
// into their short (8.3, ASCII) form when possible (folder short name + file name for files not yet written).
static void winPath(char* s, size_t n)
{
    wchar_t w[MAXPATH], sh[MAXPATH], dir[MAXPATH];
    char a[2 * MAXPATH];
    const wchar_t* use = w; DWORD k;
    if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s, -1, w, MAXPATH)) return;
    k = GetShortPathNameW(w, sh, MAXPATH);
    if (k > 0 && k < MAXPATH) use = sh;
    else
    {
        wchar_t* slash = wcsrchr(w, L'\\'); wchar_t* s2 = wcsrchr(w, L'/'); if (s2 > slash) slash = s2;
        if (slash)
        {
            size_t m = slash - w; wcsncpy(dir, w, m); dir[m] = 0;
            k = GetShortPathNameW(dir, sh, MAXPATH);
            if (k > 0 && k + wcslen(slash) < MAXPATH) { wcscat(sh, slash); use = sh; }
        }
    }
    if (WideCharToMultiByte(CP_ACP, 0, use, -1, a, sizeof(a), NULL, NULL)) { strncpy(s, a, n - 1); s[n - 1] = 0; }
}
#endif

static int readCfg(const char* file, TCfg* c)
{
    FILE* f = fopen(file, "rt");
    char line[4 * MAXPATH], *s, *key;
    int np = 0, nc = 0;
    memset(c, 0, sizeof(TCfg));
    c->threads = 1;
    if (!f) return 0;
    while (fgets(line, sizeof(line), f))
    {
        if (strncmp(line, "PART\t", 5) == 0) np++;
        else if (strncmp(line, "CPL\t", 4) == 0) nc++;
    }
    c->part = (TPartCfg*)calloc(np > 0 ? np : 1, sizeof(TPartCfg));
    c->cpl = (TCplCfg*)calloc(nc > 0 ? nc : 1, sizeof(TCplCfg));
    rewind(f);
    while (fgets(line, sizeof(line), f))
    {
        s = line;
        key = nextField(&s);
        if (!key) continue;
        if (strcmp(key, "SHM") == 0) strncpy(c->shm, nextField(&s), MAXPATH - 1);
        else if (strcmp(key, "MODE") == 0) c->mode = atoi(nextField(&s));
        else if (strcmp(key, "THREADS") == 0) c->threads = atoi(nextField(&s));
        else if (strcmp(key, "PART") == 0)
        {
            TPartCfg* p = &c->part[c->nPart];
            p->k = atoi(nextField(&s));
            p->level = atoi(nextField(&s));
            strncpy(p->inp, nextField(&s), MAXPATH - 1);
            strncpy(p->rpt, nextField(&s), MAXPATH - 1);
            strncpy(p->out, nextField(&s), MAXPATH - 1);
            c->nPart++;
        }
        else if (strcmp(key, "CPL") == 0)
        {
            TCplCfg* x = &c->cpl[c->nCpl];
            x->up = atoi(nextField(&s));
            strncpy(x->outId, nextField(&s), 255);
            strncpy(x->linkId, nextField(&s), 255);
            x->down = atoi(nextField(&s));
            strncpy(x->nodeId, nextField(&s), 255);
            c->nCpl++;
        }
    }
    fclose(f);
#ifdef _WIN32
    {
        int i;
        winPath(c->shm, MAXPATH);
        for (i = 0; i < c->nPart; i++) { winPath(c->part[i].inp, MAXPATH); winPath(c->part[i].rpt, MAXPATH); winPath(c->part[i].out, MAXPATH); }
    }
#endif
    return c->nPart > 0 && c->shm[0];
}

// ---- shared memory file
#ifdef _WIN32
static HANDLE hFile = INVALID_HANDLE_VALUE, hMap = NULL;
#endif

static void* shmMap(const char* file, size_t size, int create)
{
#ifdef _WIN32
    void* p;
    hFile = CreateFileA(file, GENERIC_READ | GENERIC_WRITE,
                        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL,
                        create ? CREATE_ALWAYS : OPEN_EXISTING,
                        FILE_ATTRIBUTE_TEMPORARY, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return NULL;
    hMap = CreateFileMappingA(hFile, NULL, PAGE_READWRITE, 0, (DWORD)size, NULL);
    if (!hMap) return NULL;
    p = MapViewOfFile(hMap, FILE_MAP_ALL_ACCESS, 0, 0, size);
    if (p && create) memset(p, 0, size);
    return p;
#else
    void* p;
    int fd = open(file, create ? (O_RDWR | O_CREAT | O_TRUNC) : O_RDWR, 0600);
    if (fd < 0) return NULL;
    if (create && ftruncate(fd, (off_t)size) != 0) { close(fd); return NULL; }
    p = mmap(NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    close(fd);
    if (p == MAP_FAILED) return NULL;
    if (create) memset(p, 0, size);
    return p;
#endif
}

// ---- barrier over all sub-models (returns FALSE when the run was aborted)
//      short spin, then the process sleeps in the kernel (futex on Linux,
//      two manual-reset events alternating by generation on Windows)
#ifdef _WIN32
static HANDLE evBar[2];
static void openEvents(const char* shm, int create)
{
    char nm[64]; unsigned h = 5381; const char* p;
    for (p = shm; *p; p++) h = h * 33 + (unsigned char)*p;
    snprintf(nm, sizeof(nm), "Local\\avcpl_%08x_0", h);
    evBar[0] = create ? CreateEventA(NULL, TRUE, FALSE, nm) : OpenEventA(EVENT_ALL_ACCESS, FALSE, nm);
    snprintf(nm, sizeof(nm), "Local\\avcpl_%08x_1", h);
    evBar[1] = create ? CreateEventA(NULL, TRUE, FALSE, nm) : OpenEventA(EVENT_ALL_ACCESS, FALSE, nm);
}
#else
static void futexWait(volatile int* a, int v)
{
    struct timespec ts = { 0, 50000000 };            // 50 ms, then re-check abort
    syscall(SYS_futex, (int*)a, FUTEX_WAIT, v, &ts, NULL, 0);
}
static void futexWake(volatile int* a) { syscall(SYS_futex, (int*)a, FUTEX_WAKE, INT_MAX, NULL, NULL, 0); }
#endif

// processors available: with at least one per sub-model the waiting processes spin (a few microseconds per
// barrier); with more sub-models than processors they yield at once (spinning would take the processor away from
// the sub-model everybody waits for)
static int NCpu = 0;
static int cpuCount(void)
{
#ifdef _WIN32
    SYSTEM_INFO si; GetSystemInfo(&si); return (int)si.dwNumberOfProcessors;
#else
    long n = sysconf(_SC_NPROCESSORS_ONLN); return n > 0 ? (int)n : 1;
#endif
}
static inline void cpuRelax(void)
{
#if defined(__x86_64__) || defined(__i386__) || defined(_M_X64)
    __builtin_ia32_pause();
#endif
}
static inline void yieldCpu(void)
{
#ifdef _WIN32
    SwitchToThread();
#else
    sched_yield();
#endif
}

static int barrier(int n)
{
    int g = __atomic_load_n(&H->gen, __ATOMIC_ACQUIRE);
    long spins = 0;
    long spinMax, yieldMax;
    if (!NCpu) NCpu = cpuCount();
    spinMax = (n <= NCpu) ? 400000 : 64;          // ~1-2 ms of spinning when every sub-model has a processor
    yieldMax = (n <= NCpu) ? 0 : 2000;
    if (__atomic_add_fetch(&H->count, 1, __ATOMIC_ACQ_REL) == n)
    {
        __atomic_store_n(&H->count, 0, __ATOMIC_RELAXED);
#ifdef _WIN32
        ResetEvent(evBar[(g + 1) & 1]);
#endif
        __atomic_add_fetch(&H->gen, 1, __ATOMIC_RELEASE);
#ifdef _WIN32
        SetEvent(evBar[g & 1]);
#else
        futexWake(&H->gen);
#endif
        return !H->abort;
    }
    while (__atomic_load_n(&H->gen, __ATOMIC_ACQUIRE) == g)
    {
        if (H->abort) return 0;
        ++spins;
        if (spins < spinMax) { cpuRelax(); continue; }
        if (spins < spinMax + yieldMax) { yieldCpu(); continue; }
#ifdef _WIN32
        WaitForSingleObject(evBar[g & 1], 50);
#else
        futexWait(&H->gen, g);
#endif
    }
    return !H->abort;
}

//=============================================================================
//  worker: one sub-model
//=============================================================================

typedef struct {
    int    c;                         // coupling index
    int    jOut, jLink, jNode;        // object indexes in this sub-model
    double sign;                      // +1 if the conduit flows into the outfall
    double qOld, vsent;               // upstream side (step coupling)
    double qpub, relax, qaOld, vrecv; // downstream side
} TLocal;

static TCfg    Cfg;
static int     Me, NUp, NDn, Aborted;
static TLocal *Up, *Dn;

static void failWorker(int k, const char* msg)
{
    char m[256];
    R[k].err = ErrorCode ? ErrorCode : 1;
    if (msg) strncpy(R[k].msg, msg, 255);
    else
    {
        swmm_getError(m, 255);
        { char* s = m; while (*s == ' ' || *s == '\n') s++; strncpy(R[k].msg, s, 255); }
    }
    R[k].status = 3;
    H->abort = 1;
}

static void neutralizeBaseInflow(int j)
// the standalone base-run inflow (time series CPL_Q_<node>) is replaced by
// the coupled flow
{
    TExtInflow* x = Node[j].extInflow;
    while (x)
    {
        if (x->param < 0 && x->tSeries >= 0 &&
            strncmp(Tseries[x->tSeries].ID, "CPL_Q_", 6) == 0)
        {
            x->sFactor = 0.0;
            x->baseline = 0.0;
        }
        x = x->next;
    }
}

static void stopRun(void)
{
    Aborted = TRUE;
    if (!ErrorCode) ErrorCode = ERR_SYSTEM;   // ends the routing step at once
}

// ---- dynamic wave: exchange inside every Picard iteration (dynwave.c hooks)
//      block 0 of V holds the iteration values
static void cplAfterLinks(void)
{
    int i;
    for (i = 0; i < NUp; i++)
    {
        TLocal* u = &Up[i]; TCplVal* w = V + u->c; int jl = u->jLink;
        double barrels = Link[jl].type == CONDUIT ? Conduit[Link[jl].subIndex].barrels : 1;
        w->q = u->sign * Link[jl].newFlow;
        w->area = (u->sign > 0 ? Link[jl].surfArea2 : Link[jl].surfArea1) * barrels;
        w->dqdh = Link[jl].dqdh;
    }
    if (!barrier(Cfg.nPart)) { stopRun(); return; }
    for (i = 0; i < NDn; i++) { int j = Dn[i].jNode; Node[j].cplQ = 0.0; Node[j].cplArea = 0.0; Node[j].cplDqdh = 0.0; }
    for (i = 0; i < NDn; i++)
    {
        TCplVal* w = V + Dn[i].c; int j = Dn[i].jNode;
        Node[j].cplQ += w->q;
        Node[j].cplArea += w->area;
        Node[j].cplDqdh += w->dqdh;
    }
}

static int cplAfterNodes(int converged)
{
    int i, all = TRUE;
    if (Aborted) return TRUE;
    for (i = 0; i < NDn; i++)
        V[Dn[i].c].h = Node[Dn[i].jNode].invertElev + Node[Dn[i].jNode].newDepth;
    R[Me].conv = converged;
    if (!barrier(Cfg.nPart)) { stopRun(); return TRUE; }
    for (i = 0; i < Cfg.nPart; i++) if (!R[i].conv) all = FALSE;
    for (i = 0; i < NUp; i++) Node[Up[i].jOut].cplHead = V[Up[i].c].h;
    return all;
}

static int runWorker(const char* cfgFile, int k)
{
    void* base;
    int i, err, dw;
    long n = 0;
    double elapsed = 0.0, dt, t0 = wallTime();
    char msg[600];
    FILE* dbg = NULL;

    Me = k;
    if (!readCfg(cfgFile, &Cfg)) return 1;
    if (getenv("AVCPL_DEBUG") && k == 0)
    {
        char f[MAXPATH + 16]; snprintf(f, sizeof(f), "%s.log", Cfg.shm); dbg = fopen(f, "wt");
    }
    base = shmMap(Cfg.shm, shmSize(Cfg.nPart, Cfg.nCpl), 0);
    if (!base) return 2;
    shmSetPtrs(base, Cfg.nPart, Cfg.nCpl);
#ifdef _WIN32
    openEvents(Cfg.shm, 0);
#endif

    AvarisSkipDetail = 1;
    err = swmm_open(Cfg.part[k].inp, Cfg.part[k].rpt, Cfg.part[k].out);
    if (err) { failWorker(k, NULL); barrier(Cfg.nPart); return err; }
    osem_applyExtensions(Cfg.part[k].inp);
    if (Cfg.threads > 0) NumThreads = Cfg.threads;
    SkipSteadyState = FALSE;          // every sub-model iterates in every step
    // results of all objects (needed to merge the run of the master model)
    for (i = 0; i < Nobjects[SUBCATCH]; i++) Subcatch[i].rptFlag = TRUE;
    for (i = 0; i < Nobjects[NODE]; i++) Node[i].rptFlag = TRUE;
    for (i = 0; i < Nobjects[LINK]; i++) Link[i].rptFlag = TRUE;
    RptFlags.subcatchments = ALL; RptFlags.nodes = ALL; RptFlags.links = ALL;

    // --- the cuts of this sub-model
    Up = (TLocal*)calloc(Cfg.nCpl + 1, sizeof(TLocal));
    Dn = (TLocal*)calloc(Cfg.nCpl + 1, sizeof(TLocal));
    for (i = 0; i < Cfg.nCpl; i++)
    {
        TCplCfg* c = &Cfg.cpl[i];
        if (c->up == k)
        {
            TLocal* u = &Up[NUp++];
            u->c = i;
            u->jOut = project_findObject(NODE, c->outId);
            u->jLink = project_findObject(LINK, c->linkId);
            if (u->jOut < 0 || u->jLink < 0 || Node[u->jOut].type != OUTFALL)
            {
                snprintf(msg, sizeof(msg), "coupling %s / %s not found in sub-model %d", c->outId, c->linkId, k + 1);
                failWorker(k, msg); barrier(Cfg.nPart); return 1;
            }
            u->sign = (Link[u->jLink].node2 == u->jOut) ? 1.0 : -1.0;
            Node[u->jOut].cplBnd = TRUE;
        }
        if (c->down == k)
        {
            TLocal* d = &Dn[NDn++];
            d->c = i;
            d->jNode = project_findObject(NODE, c->nodeId);
            if (d->jNode < 0)
            {
                snprintf(msg, sizeof(msg), "coupled node %s not found in sub-model %d", c->nodeId, k + 1);
                failWorker(k, msg); barrier(Cfg.nPart); return 1;
            }
            Node[d->jNode].cplDown = TRUE;
            neutralizeBaseInflow(d->jNode);
        }
    }

    err = swmm_start(TRUE);
    if (err) { failWorker(k, NULL); barrier(Cfg.nPart); return err; }
    dw = (RouteModel == DW);
    if (dw) { CplAfterLinks = cplAfterLinks; CplAfterNodes = cplAfterNodes; }
    if (k == 0) H->totalDays = TotalDuration / MSECperDAY;
    R[k].status = 1;

    // --- initial state (all value blocks)
    for (i = 0; i < NUp; i++)
    {
        TLocal* u = &Up[i]; int b;
        u->qOld = u->sign * Link[u->jLink].newFlow;
        for (b = 0; b < 3; b++) { TCplVal* v = V + b * Cfg.nCpl + u->c; v->q = u->qOld; v->area = 0; v->dqdh = 0; v->vsent = 0; }
    }
    for (i = 0; i < NDn; i++)
    {
        TLocal* d = &Dn[i]; int b;
        for (b = 0; b < 3; b++) V[b * Cfg.nCpl + d->c].h = Node[d->jNode].invertElev + Node[d->jNode].newDepth;
    }
    if (!barrier(Cfg.nPart)) goto finish;
    for (i = 0; i < NUp; i++)
    {
        TLocal* u = &Up[i];
        Node[u->jOut].cplHead = V[u->c].h;
        Node[u->jOut].newDepth = MAX(0.0, Node[u->jOut].cplHead - Node[u->jOut].invertElev);
    }
    for (i = 0; i < NDn; i++) Dn[i].qaOld = V[Dn[i].c].q;

    // --- time stepping: every sub-model takes the smallest proposed step
    for (;;)
    {
        TCplVal *cur = V + (1 + (n & 1)) * Cfg.nCpl, *nxt = V + (1 + ((n + 1) & 1)) * Cfg.nCpl;
        R[k].dtProp[n & 1] = swmm_proposeStep();
        if (ErrorCode) { failWorker(k, NULL); break; }
        if (!barrier(Cfg.nPart)) break;
        dt = 1.0e30;
        for (i = 0; i < Cfg.nPart; i++) if (R[i].dtProp[n & 1] < dt) dt = R[i].dtProp[n & 1];
        if (dt <= 0.0) break;
        if (dbg && n % 200 == 0) fprintf(dbg, "%ld %.5f %.4f\n", n, NewRoutingTime / 3600000.0, dt);

        if (!dw)
        {
            // --- other routing methods: exchange once per step
            for (i = 0; i < NUp; i++) Node[Up[i].jOut].cplHead = cur[Up[i].c].h;
            for (i = 0; i < NDn; i++) Node[Dn[i].jNode].apiExtInflow = 0.0;
            for (i = 0; i < NDn; i++)
            {
                TLocal* d = &Dn[i]; TCplVal* v = cur + d->c;
                double R0 = v->vsent - d->vrecv, qx, lim;
                d->qpub = v->q;
                qx = 2.0 * R0 / dt - d->qaOld;      // receive what was sent
                d->relax = (qx - d->qpub) / RELAX;
                lim = 0.5 * fabs(d->qpub) + 0.01;
                if (d->relax > lim) d->relax = lim;
                if (d->relax < -lim) d->relax = -lim;
                Node[d->jNode].apiExtInflow += d->qpub + d->relax;
            }
        }

        swmm_stepFixed(dt, &elapsed);
        if (Aborted) break;
        if (ErrorCode) { failWorker(k, NULL); break; }

        if (dw)
        {
            // --- the coupled inflow counts as inflow of this sub-model
            for (i = 0; i < NDn; i++)
            {
                double q = V[Dn[i].c].q;
                massbal_addCplVolume(0.5 * (Dn[i].qaOld + q) * dt);
                { double v = 0.5 * (Dn[i].qaOld + q) * dt; R[k].vol[v >= 0 ? 0 : 1] += fabs(v); }
                Dn[i].qaOld = q;
            }
            for (i = 0; i < NUp; i++)
            {
                double q = Up[i].sign * Link[Up[i].jLink].newFlow;
                { double v = 0.5 * (Up[i].qOld + q) * dt; R[k].vol[v >= 0 ? 2 : 3] += fabs(v); }
                Up[i].qOld = q;
            }
        }
        else
        {
            for (i = 0; i < NUp; i++)
            {
                TLocal* u = &Up[i]; TCplVal* w = nxt + u->c;
                double q = u->sign * Link[u->jLink].newFlow;
                u->vsent += 0.5 * (u->qOld + q) * dt;
                { double v = 0.5 * (u->qOld + q) * dt; R[k].vol[v >= 0 ? 2 : 3] += fabs(v); }
                u->qOld = q;
                w->q = q; w->vsent = u->vsent;
            }
            for (i = 0; i < NDn; i++)
            {
                TLocal* d = &Dn[i]; TCplVal* w = nxt + d->c;
                double qa = d->qpub + d->relax;
                d->vrecv += 0.5 * (d->qaOld + qa) * dt;
                { double v = 0.5 * (d->qaOld + qa) * dt; R[k].vol[v >= 0 ? 0 : 1] += fabs(v); }
                d->qaOld = qa;
                w->h = Node[d->jNode].invertElev + Node[d->jNode].newDepth;
            }
        }
        if (k == 0) H->tDays = NewRoutingTime / MSECperDAY;
        n++;
    }

finish:
    if (dbg) fclose(dbg);
    R[k].steps = n;
    CplAfterLinks = NULL; CplAfterNodes = NULL;
    if (Aborted && R[k].status != 3) { R[k].status = 4; swmm_close(); return 1; }
    if (R[k].status == 3) { swmm_end(); swmm_close(); return 1; }
    swmm_end();
    if (!H->abort) swmm_report();
    {
        float e1 = 0, e2 = 0, e3 = 0;
        swmm_getMassBalErr(&e1, &e2, &e3);
        R[k].e1 = e1; R[k].e2 = e2; R[k].e3 = e3;
    }
    if (ErrorCode) failWorker(k, NULL);
    swmm_close();
    R[k].secs = wallTime() - t0;
    if (R[k].status != 3) R[k].status = 2;
    return 0;
}

//=============================================================================
//  coordinator
//=============================================================================

static int ownPath(char* buf, size_t n)
{
#ifdef _WIN32
    return GetModuleFileNameA(NULL, buf, (DWORD)n) > 0;
#else
    ssize_t r = readlink("/proc/self/exe", buf, n - 1);
    if (r <= 0) return 0;
    buf[r] = 0;
    return 1;
#endif
}

static int runCoordinator(const char* cfgFile)
{
    TCfg cfg;
    void* base;
    char exe[MAXPATH];
    int i, err = 0, alive;
    double t0 = wallTime(), pct, lastPct = -1;
    float e1 = 0, e2 = 0, e3 = 0;
#ifdef _WIN32
    HANDLE job, *procs;
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION jl;
#else
    pid_t* pids;
#endif

    setvbuf(stdout, NULL, _IONBF, 0);
    if (!readCfg(cfgFile, &cfg)) { printf("ERROR cannot read %s\nDONE 1 0 0 0 0\n", cfgFile); return 1; }
    base = shmMap(cfg.shm, shmSize(cfg.nPart, cfg.nCpl), 1);
    if (!base) { printf("ERROR cannot create %s\nDONE 1 0 0 0 0\n", cfg.shm); return 1; }
    shmSetPtrs(base, cfg.nPart, cfg.nCpl);
    H->nPart = cfg.nPart; H->nCpl = cfg.nCpl;
#ifdef _WIN32
    openEvents(cfg.shm, 1);
#endif
    if (!ownPath(exe, sizeof(exe))) { printf("ERROR engine path\nDONE 1 0 0 0 0\n"); return 1; }
    printf("COUPLED %d sub-models, %d couplings, mode %d\n", cfg.nPart, cfg.nCpl, cfg.mode);

#ifdef _WIN32
    // the sub-models are ended together with this process (job object)
    job = CreateJobObjectA(NULL, NULL);
    memset(&jl, 0, sizeof(jl));
    jl.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    SetInformationJobObject(job, JobObjectExtendedLimitInformation, &jl, sizeof(jl));
    procs = (HANDLE*)calloc(cfg.nPart, sizeof(HANDLE));
    for (i = 0; i < cfg.nPart; i++)
    {
        char cmd[3 * MAXPATH];
        STARTUPINFOA si; PROCESS_INFORMATION pi;
        memset(&si, 0, sizeof(si)); si.cb = sizeof(si);
        snprintf(cmd, sizeof(cmd), "\"%s\" -cplworker \"%s\" %d", exe, cfgFile, i);
        if (!CreateProcessA(NULL, cmd, NULL, NULL, FALSE, CREATE_NO_WINDOW | CREATE_SUSPENDED, NULL, NULL, &si, &pi))
        {
            printf("ERROR cannot start sub-model %d\n", i + 1);
            H->abort = 1; err = 1; break;
        }
        AssignProcessToJobObject(job, pi.hProcess);
        ResumeThread(pi.hThread);
        CloseHandle(pi.hThread);
        procs[i] = pi.hProcess;
    }
#else
    pids = (pid_t*)calloc(cfg.nPart, sizeof(pid_t));
    for (i = 0; i < cfg.nPart; i++)
    {
        pid_t p = fork();
        if (p == 0)
        {
            char ks[16];
            prctl(PR_SET_PDEATHSIG, SIGKILL);
            snprintf(ks, sizeof(ks), "%d", i);
            execl(exe, exe, "-cplworker", cfgFile, ks, (char*)NULL);
            _exit(127);
        }
        pids[i] = p;
    }
#endif

    // --- progress until all sub-models have ended
    do
    {
#ifdef _WIN32
        Sleep(150);
        alive = 0;
        for (i = 0; i < cfg.nPart; i++) if (procs[i] && WaitForSingleObject(procs[i], 0) == WAIT_TIMEOUT) alive++;
#else
        usleep(150000);
        alive = 0;
        for (i = 0; i < cfg.nPart; i++) if (pids[i] > 0)
        {
            int st;
            if (waitpid(pids[i], &st, WNOHANG) == pids[i]) pids[i] = 0; else alive++;
        }
#endif
        H->beat++;
        if (alive < cfg.nPart)
        {
            // a sub-model that ended early without finishing stops the run
            for (i = 0; i < cfg.nPart; i++)
            {
#ifdef _WIN32
                int gone = procs[i] && WaitForSingleObject(procs[i], 0) != WAIT_TIMEOUT;
#else
                int gone = pids[i] == 0;
#endif
                if (gone && R[i].status < 2) { R[i].status = 3; if (!R[i].err) R[i].err = 1; if (!R[i].msg[0]) strcpy(R[i].msg, "sub-model process ended unexpectedly"); H->abort = 1; }
            }
        }
        if (H->totalDays > 0)
        {
            pct = 100.0 * H->tDays / H->totalDays;
            if (pct - lastPct >= 0.5) { printf("PROGRESS %.1f\n", pct); lastPct = pct; }
        }
    } while (alive > 0);

    for (i = 0; i < cfg.nPart; i++)
    {
        printf("PART %d %d %ld %.2f %.3f %.3f\n", i + 1, R[i].err, R[i].steps, R[i].secs, R[i].e1, R[i].e2);
        if (R[i].err && !err) err = R[i].err;
        if (R[i].err && R[i].msg[0]) printf("ERROR sub-model %d: %s\n", i + 1, R[i].msg);
        if (fabs(R[i].e1) > fabs(e1)) e1 = R[i].e1;
        if (fabs(R[i].e2) > fabs(e2)) e2 = R[i].e2;
        if (fabs(R[i].e3) > fabs(e3)) e3 = R[i].e3;
    }
    {
        double v[4] = { 0, 0, 0, 0 }; int m;
        for (i = 0; i < cfg.nPart; i++) for (m = 0; m < 4; m++) v[m] += R[i].vol[m];
        // volumes counted as inflow / as outflow by the sub-models' mass balances
        printf("CPLVOL %.6e %.6e\n", v[0] + v[3], v[2] + v[1]);
    }
    printf("DONE %d %.3f %.3f %.3f %.2f\n", err, e1, e2, e3, wallTime() - t0);
    // --- remove the shared memory file
#ifdef _WIN32
    UnmapViewOfFile(base); CloseHandle(hMap); CloseHandle(hFile); DeleteFileA(cfg.shm);
#else
    munmap(base, shmSize(cfg.nPart, cfg.nCpl)); unlink(cfg.shm);
#endif
    return err;
}

int couple_main(int argc, char* argv[])
{
    if (argc >= 3 && strcmp(argv[1], "-couple") == 0) return runCoordinator(argv[2]);
    if (argc >= 4 && strcmp(argv[1], "-cplworker") == 0) return runWorker(argv[2], atoi(argv[3]));
    return -1;
}
