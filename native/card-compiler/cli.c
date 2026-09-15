#include "PikaCompiler.h"
#include <stdio.h>

int main(int argc, char** argv) {
    if (argc != 3) {
        fprintf(stderr, "Usage: card-compiler input.py output.py.o\n");
        return 2;
    }
    PIKA_RES result = pikaCompileFileWithOutputName(argv[2], argv[1]);
    if (result != PIKA_RES_OK) {
        remove(argv[2]);
        fprintf(stderr, "Compilation failed: %d\n", (int)result);
        return 1;
    }
    return 0;
}
