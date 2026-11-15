package main

import (
	"encoding/binary"
	"fmt"
	"os"
	"unsafe"

	"github.com/hf/nsm"
	"github.com/hf/nsm/request"
	"golang.org/x/sys/unix"
)

// A freshly booted Nitro Enclave has an unseeded kernel RNG - there is no /dev/random hardware source until the
// nsm-hwrng registers, so crypto/rand's getrandom(2) intermittently blocks or fails on the first TLS handshakes
// (attest, then the pdm fetch). seedEntropy pulls real entropy from the NSM and credits it to the kernel pool up
// front, so those handshakes do not stall. sce-unit is the enclave's PID 1 (CAP_SYS_ADMIN), so RNDADDENTROPY is
// permitted; outside an enclave (no /dev/nsm) OpenDefaultSession fails and the run aborts.
func seedEntropy() error {
	sess, err := nsm.OpenDefaultSession()
	if err != nil {
		return fmt.Errorf("open NSM: %w", err)
	}
	defer sess.Close()

	f, err := os.OpenFile("/dev/random", os.O_WRONLY, 0)
	if err != nil {
		return fmt.Errorf("open /dev/random: %w", err)
	}
	defer f.Close()

	// 16 rounds of up to 256 NSM bytes each is far more than the pool's init threshold.
	for i := 0; i < 16; i++ {
		res, err := sess.Send(&request.GetRandom{})
		if err != nil {
			return fmt.Errorf("NSM GetRandom: %w", err)
		}
		if res.Error != "" {
			return fmt.Errorf("NSM: %s", res.Error)
		}
		if res.GetRandom == nil || len(res.GetRandom.Random) == 0 {
			return fmt.Errorf("NSM returned no random bytes")
		}
		if err := creditEntropy(f, res.GetRandom.Random); err != nil {
			return err
		}
	}
	return nil
}

// creditEntropy adds b to the kernel pool via RNDADDENTROPY, crediting the full byte count as entropy bits. The
// ioctl argument is struct rand_pool_info { int entropy_count; int buf_size; __u32 buf[]; }.
func creditEntropy(f *os.File, b []byte) error {
	buf := make([]byte, 8+len(b))
	binary.LittleEndian.PutUint32(buf[0:4], uint32(len(b)*8))
	binary.LittleEndian.PutUint32(buf[4:8], uint32(len(b)))
	copy(buf[8:], b)

	_, _, errno := unix.Syscall(unix.SYS_IOCTL, f.Fd(), unix.RNDADDENTROPY, uintptr(unsafe.Pointer(&buf[0])))
	if errno != 0 {
		return fmt.Errorf("RNDADDENTROPY: %w", errno)
	}
	return nil
}
