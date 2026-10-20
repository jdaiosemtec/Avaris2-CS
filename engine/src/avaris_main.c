//-----------------------------------------------------------------------------
//   avaris_main.c
//
//   Avaris Hydraulic Engine - command line runner.
//   Built on the EPA SWMM 5.2.4 computational engine with the Avaris
//   convergence modifications (configurable under-relaxation, OpenMP node
//   depth solution, extended nonconvergence reporting).
//
//   Usage:  avaris_engine <input.inp> <report.rpt> <output.out> [-nodetail]
//
//   Writes machine-readable progress lines to stdout for the GUI:
//       PROGRESS <percent>
//       DONE <errorcode> <runoffErr> <flowErr> <qualErr> <seconds>
//       ERROR <message>
//-----------------------------------------------------------------------------
#include <stdio.h>
#include <string.h>
#include <time.h>
#include "swmm5.h"

extern double TotalDuration;     // simulation duration (msec) from globals
extern int    AvarisSkipDetail;  // omit time series tables from report
int osem_applyExtensions(const char* inpFile);

int main(int argc, char *argv[])
{
    char errMsg[256];
    double elapsed = 0.0, total, pct, lastPct = -1.0;
    float e1 = 0, e2 = 0, e3 = 0;
    int err = 0;
    clock_t t0 = clock();

    if (argc >= 2 && (strcmp(argv[1], "-v") == 0 || strcmp(argv[1], "--version") == 0))
    {
        int v = swmm_getVersion();
        printf("OsemCM Engine (SWMM %d.%d.%d core, Avaris mods)\n", v/10000, (v%10000)/1000, v%1000);
        return 0;
    }
    if (argc < 4)
    {
        printf("Usage: avaris_engine <input.inp> <report.rpt> <output.out>\n");
        return 1;
    }
    setvbuf(stdout, NULL, _IONBF, 0);
    if (argc >= 5 && strcmp(argv[4], "-nodetail") == 0) AvarisSkipDetail = 1;

    err = swmm_open(argv[1], argv[2], argv[3]);
    if (!err) osem_applyExtensions(argv[1]);
    if (!err) err = swmm_start(1);
    if (!err)
    {
        total = TotalDuration / 86400000.0;      // days
        do
        {
            err = swmm_step(&elapsed);
            if (total > 0.0)
            {
                pct = 100.0 * elapsed / total;
                if (pct - lastPct >= 0.5)
                {
                    printf("PROGRESS %.1f\n", pct);
                    lastPct = pct;
                }
            }
        } while (elapsed > 0.0 && !err);
        swmm_end();
    }
    if (err == 0 || err > 100) swmm_report();
    swmm_getMassBalErr(&e1, &e2, &e3);
    if (err)
    {
        swmm_getError(errMsg, 255);
        {
            char *m = errMsg;
            while (*m == ' ' || *m == '\n') m++;
            printf("ERROR %s\n", m);
        }
    }
    swmm_close();
    printf("DONE %d %.3f %.3f %.3f %.2f\n", err, e1, e2, e3,
           (double)(clock() - t0) / CLOCKS_PER_SEC);
    return err;
}
