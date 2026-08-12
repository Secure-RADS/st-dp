package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default()

	r.GET("/", func(c *gin.Context) {
		c.String(http.StatusOK, "hello from execution-service")
	})

	r.POST("/run", func(c *gin.Context) {
		var req struct {
			AlgorithmId string `json:"algorithmId" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.String(http.StatusBadRequest, "invalid request: %v", err)
			return
		}
		c.String(http.StatusNotImplemented, "run not implemented yet")
	})

	r.Run(":8080")
}
