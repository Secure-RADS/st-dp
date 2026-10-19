package env

import (
	"fmt"
	"os"
)

func Required(name string) (string, error) {
	value, ok := os.LookupEnv(name)
	if !ok || value == "" {
		return "", fmt.Errorf("missing required environment variable: %s", name)
	}
	return value, nil
}
