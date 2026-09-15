#include "PikaObj.h"
/* Shared VM structures reference this symbol. Compilation never starts a VM. */
volatile PikaObj* __pikaMain = NULL;
