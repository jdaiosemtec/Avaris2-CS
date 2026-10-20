//-----------------------------------------------------------------------------
//   osem_ext.c
//
//   OsemCM model extensions stored as comment lines in the .inp file, so that
//   EPA SWMM and Avaris DS simply ignore them:
//       ;;@OSEM CHAMBER  <node>         <chamber plan area, ft2 or m2>
//       ;;@OSEM IMPCOEF  <subcatchment> <impervious runoff coefficient 0-1>
//-----------------------------------------------------------------------------
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "headers.h"

int osem_applyExtensions(const char* inpFile)
{
    FILE* f = fopen(inpFile, "rt");
    char line[1024], key[64], id[512];
    double v;
    int k, n = 0;
    if (f == NULL) return 0;
    while (fgets(line, sizeof(line), f))
    {
        char* s = line;
        while (*s == ' ' || *s == '\t') s++;
        if (strncmp(s, ";;@OSEM", 7) != 0) continue;
        if (sscanf(s + 7, "%63s %511s %lf", key, id, &v) != 3) continue;
        if (strcmp(key, "CHAMBER") == 0)
        {
            k = project_findObject(NODE, id);
            if (k >= 0 && v >= 0.0)
            {
                Node[k].chamberArea = v / (UCF(LENGTH) * UCF(LENGTH));
                n++;
            }
        }
        else if (strcmp(key, "IMPCOEF") == 0)
        {
            k = project_findObject(SUBCATCH, id);
            if (k >= 0 && v >= 0.0 && v <= 1.0)
            {
                Subcatch[k].impLoss = 1.0 - v;
                n++;
            }
        }
    }
    fclose(f);
    return n;
}
