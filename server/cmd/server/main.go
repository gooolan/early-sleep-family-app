package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"early-sleep-family/server/internal/app"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
	dataDirectory := envOrDefault("DATA_DIR", "./data")
	updateDirectory := envOrDefault("UPDATE_DIR", "./updates")
	listenAddress := envOrDefault("LISTEN_ADDR", ":8080")
	dataDirectory, err := filepath.Abs(dataDirectory)
	if err != nil {
		logger.Error("resolve data directory", "error", err)
		os.Exit(1)
	}
	updateDirectory, err = filepath.Abs(updateDirectory)
	if err != nil {
		logger.Error("resolve update directory", "error", err)
		os.Exit(1)
	}

	store, err := app.NewStore(dataDirectory)
	if err != nil {
		logger.Error("initialize store", "error", err)
		os.Exit(1)
	}

	handler := app.NewHTTPHandler(app.NewService(store), logger, updateDirectory)
	server := &http.Server{
		Addr:              listenAddress,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      5 * time.Minute,
		IdleTimeout:       60 * time.Second,
	}

	serverError := make(chan error, 1)
	go func() {
		logger.Info("server started", "address", listenAddress, "dataDirectory", dataDirectory, "updateDirectory", updateDirectory)
		serverError <- server.ListenAndServe()
	}()

	signalContext, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	select {
	case err = <-serverError:
		if !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server stopped unexpectedly", "error", err)
			os.Exit(1)
		}
	case <-signalContext.Done():
		shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		err = server.Shutdown(shutdownContext)
		if err != nil {
			logger.Error("graceful shutdown failed", "error", err)
			os.Exit(1)
		}
	}
}

func envOrDefault(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
