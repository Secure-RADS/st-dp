package main

import (
	"fmt"
	"os"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintf(os.Stderr, "usage: %s <fetch-records|checkpoint|executor-finished|run-result> ...\n", os.Args[0])
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "fetch-records":
		err = fetchRecords(os.Args[2:])
	case "checkpoint":
		err = checkpoint(os.Args[2:])
	case "executor-finished":
		err = executorFinished(os.Args[2:])
	case "run-result":
		err = runResult(os.Args[2:])
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n", os.Args[1])
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s: %v\n", os.Args[1], err)
		os.Exit(1)
	}
}
